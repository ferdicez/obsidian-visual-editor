import { Menu, Notice, TextFileView, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { botaoIcone, desenharControle } from "./controles";
import {
	Formato,
	ModoAgrupamento,
	agrupar,
	escrever,
	formatoDe,
	ler,
	modoDisponivel,
} from "./documento";
import { extrairVariavel, ligarVariavel, variaveisCompativeis } from "./extrair";
import { ModalNomeVariavel, sugerirNome } from "./modal-nome";
import { PopoverToken } from "./popover-token";
import type VisualEditorPlugin from "./main";
import { Campo, humanizar } from "./tipos";

export const TIPO_VISTA_VISUAL = "visual-editor-vista";

/**
 * A view que mostra o arquivo como interface em vez de código.
 *
 * Herda de `TextFileView` porque o conteúdo É o texto do arquivo: o Obsidian cuida de carregar,
 * marcar como sujo e salvar, e o plugin só precisa dizer como desenhar (`setViewData`) e o que
 * gravar (`getViewData`). Reimplementar isso à mão significaria brigar com o ciclo de salvamento
 * do app — que é o caminho mais curto para perder o trabalho dela.
 *
 * O `texto` guardado aqui é sempre o arquivo INTEIRO, incluindo tudo o que a interface não mostra.
 * Editar um controle reescreve só os caracteres daquele valor dentro dele.
 */
export class VistaVisual extends TextFileView {
	private plugin: VisualEditorPlugin;

	/** O conteúdo integral do arquivo — a fonte de verdade. */
	private texto = "";
	private formato: Formato = "css";
	private campos: Campo[] = [];
	private naoEditaveis = 0;

	/** Modo código mostra o texto cru numa textarea, para ela conferir ou editar à mão. */
	private modoCodigo = false;

	/**
	 * Qual das duas listas está à vista: os tokens (`--cor: red`) ou os elementos (`.card { … }`).
	 *
	 * São dois assuntos diferentes — "quanto vale este token" e "que token este elemento usa" — e
	 * misturá-los numa lista só produziria dezenas de itens onde ela procura um. A aba some quando o
	 * arquivo tem só um dos dois.
	 */
	private aba: "tokens" | "elementos" = "tokens";

	/**
	 * As duas listas lado a lado, em vez de uma aba por vez.
	 *
	 * Pedido dela: *"talvez, quando eu clicar em editar, uma sugestão fosse de abrir as duas
	 * emparelhadas, uma do lado da outra"*. É um modo, não o padrão: numa aba estreita metade da
	 * largura para cada lista deixa as duas ruins, e o CSS devolve para coluna única sozinho.
	 */
	private emparelhado = false;

	/** A janelinha de edição de token, aberta a partir de uma ficha na aba Elementos. */
	private popover = new PopoverToken();

	private corpo!: HTMLElement;
	private barra!: HTMLElement;
	private filtro = "";

	/**
	 * Salvar é adiado: um arrastar de slider gera muitos `change` seguidos, e cada gravação dispara
	 * o hot reload do dev server dela. 400ms junta a rajada num único salvamento.
	 */
	private salvarAdiado = debounce(() => this.requestSave(), 400, true);

	constructor(leaf: WorkspaceLeaf, plugin: VisualEditorPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TIPO_VISTA_VISUAL;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Editor visual";
	}

	getIcon(): string {
		return "sliders-horizontal";
	}

	/** O que o Obsidian grava no arquivo. É sempre o texto integral. */
	getViewData(): string {
		return this.texto;
	}

	/**
	 * Chamado ao abrir o arquivo e sempre que ele muda no disco.
	 *
	 * `limpar` vem `true` quando é um arquivo novo. Nos dois casos relemos do zero: o arquivo pode
	 * ter sido alterado pelo editor de código dela por fora, e os deslocamentos guardados não
	 * valeriam mais.
	 */
	setViewData(dados: string, _limpar: boolean): void {
		this.texto = dados;
		this.formato = formatoDe(this.file?.extension ?? "") ?? "css";

		const documento = ler(dados, this.formato);
		this.campos = documento.campos;
		this.naoEditaveis = documento.naoEditaveis;

		this.desenhar();
	}

	clear(): void {
		this.texto = "";
		this.campos = [];
		this.naoEditaveis = 0;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("visual-editor-vista");
	}

	async onClose(): Promise<void> {
		// A janelinha vive no `body`, fora do `contentEl`: esvaziar a view não a levaria junto, e ela
		// ficaria órfã na tela depois de fechar a aba.
		this.popover.fechar();
		this.contentEl.empty();
	}

	// -------------------------------------------------------------------------------------------
	// Desenho
	// -------------------------------------------------------------------------------------------

	private desenhar(): void {
		// A posição de rolagem é restaurada porque `desenhar()` roda a cada gravação: sem isso, mexer
		// num controle lá embaixo jogaria a tela de volta ao topo a cada ajuste.
		const rolagem = this.corpo?.scrollTop ?? 0;

		this.contentEl.empty();
		this.desenharBarra();

		this.corpo = this.contentEl.createDiv({ cls: "ve-corpo" });

		if (this.modoCodigo) {
			this.desenharCodigo();
		} else if (this.emparelhadoAtivo) {
			this.desenharEmparelhado();
		} else {
			this.desenharCampos();
		}

		this.corpo.scrollTop = rolagem;
	}

	/** Os tokens: as declarações de variável. É o que o plugin sempre editou. */
	private get tokens(): Campo[] {
		return this.campos.filter((campo) => campo.papel !== "propriedade");
	}

	/** Os usos: as propriedades dentro das regras (`.card { padding: … }`). */
	private get elementos(): Campo[] {
		if (!this.plugin.configuracoes.mostrarElementos) return [];
		return this.campos.filter((campo) => campo.papel === "propriedade");
	}

	/** A lista em exibição, conforme a aba — e o fallback quando a aba escolhida está vazia. */
	private get camposDaAba(): Campo[] {
		if (this.aba === "elementos" && this.elementos.length > 0) return this.elementos;
		if (this.aba === "tokens" && this.tokens.length > 0) return this.tokens;
		return this.tokens.length > 0 ? this.tokens : this.elementos;
	}

	private desenharBarra(): void {
		this.barra = this.contentEl.createDiv({ cls: "ve-barra" });

		const esquerda = this.barra.createDiv({ cls: "ve-barra-esquerda" });

		// As abas só aparecem quando há os dois assuntos: num arquivo de tokens puro, uma aba
		// "Elementos" vazia seria só um lugar a mais para ela clicar e não achar nada.
		const temOsDois = this.tokens.length > 0 && this.elementos.length > 0;

		if (!this.modoCodigo && temOsDois && !this.emparelhado) {
			const abas = esquerda.createDiv({ cls: "ve-abas" });

			const criarAba = (id: "tokens" | "elementos", rotulo: string, quantos: number, dica: string) => {
				const botao = abas.createEl("button", {
					cls: "ve-aba",
					attr: { type: "button", "aria-pressed": String(this.aba === id), title: dica },
				});
				botao.createSpan({ text: rotulo });
				botao.createSpan({ cls: "ve-aba-contagem", text: String(quantos) });
				botao.toggleClass("is-ativa", this.aba === id);
				botao.addEventListener("click", () => {
					if (this.aba === id) return;
					this.aba = id;
					this.desenhar();
				});
			};

			criarAba(
				"tokens",
				"Tokens",
				this.tokens.length,
				"As variáveis do arquivo. Mudar uma aqui muda em todo lugar que a usa."
			);
			criarAba(
				"elementos",
				"Elementos",
				this.elementos.length,
				"As regras do arquivo (.card, .botao) e qual variável cada uma usa."
			);
		}

		const busca = esquerda.createEl("input", {
			cls: "ve-busca",
			attr: { type: "search", placeholder: "Filtrar…", value: this.filtro },
		});
		busca.addEventListener("input", () => {
			this.filtro = busca.value.trim().toLowerCase();
			// Só a lista é redesenhada: recriar a barra tiraria o foco do campo a cada tecla.
			this.corpo.empty();
			if (this.modoCodigo) this.desenharCodigo();
			else this.desenharCampos();
		});
		if (this.modoCodigo) busca.hide();

		const direita = this.barra.createDiv({ cls: "ve-barra-direita" });

		const contagem = direita.createSpan({ cls: "ve-contagem" });
		const quantos = this.camposDaAba.length;
		contagem.setText(quantos === 1 ? "1 controle" : `${quantos} controles`);

		// Na aba de elementos não há escolha de agrupamento — é sempre por regra.
		if (!this.modoCodigo && (this.aba !== "elementos" || this.emparelhadoAtivo)) {
			this.desenharSeletorAgrupamento(direita);
		}

		if (!this.modoCodigo && temOsDois) {
			const botao = botaoIcone(
				direita,
				this.emparelhado ? "square" : "columns-2",
				this.emparelhado ? "Ver uma lista por vez" : "Ver tokens e elementos lado a lado",
				() => {
					this.emparelhado = !this.emparelhado;
					this.desenhar();
				}
			);
			botao.toggleClass("is-ativo", this.emparelhado);
		}

		botaoIcone(
			direita,
			this.modoCodigo ? "sliders-horizontal" : "code",
			this.modoCodigo ? "Ver como interface" : "Ver o código",
			() => {
				this.modoCodigo = !this.modoCodigo;
				this.desenhar();
			}
		);
	}

	/**
	 * O modo de agrupamento que REALMENTE vale para este arquivo.
	 *
	 * A escolha dela é uma preferência que atravessa arquivos, e nem todo arquivo a comporta: um CSS
	 * sem nenhum comentário de seção não tem como ser agrupado por seção. Em vez de mostrar uma tela
	 * com tudo em "Outros" — que pareceria defeito —, cai para o próximo modo que funciona.
	 */
	private get agrupamentoEfetivo(): ModoAgrupamento {
		// Na aba de elementos o grupo é sempre a regra: agrupar `.card { padding }` por prefixo do
		// nome da propriedade separaria as declarações do mesmo elemento, que é o oposto do útil.
		if (this.aba === "elementos") return "estrutura";
		return this.agrupamentoDeTokens;
	}

	/** O agrupamento válido para a lista de tokens, com o fallback quando o modo não se aplica. */
	private get agrupamentoDeTokens(): ModoAgrupamento {
		const escolhido = this.plugin.configuracoes.agrupamento;
		if (modoDisponivel(this.tokens, escolhido)) return escolhido;
		if (modoDisponivel(this.tokens, "prefixo")) return "prefixo";
		return "estrutura";
	}

	/**
	 * O modo emparelhado está ativo de fato?
	 *
	 * Só faz sentido quando existem as duas listas — num arquivo de tokens puro, uma coluna
	 * "Elementos" vazia ao lado seria metade da tela desperdiçada.
	 */
	private get emparelhadoAtivo(): boolean {
		return this.emparelhado && this.tokens.length > 0 && this.elementos.length > 0;
	}

	/**
	 * O seletor de agrupamento: um menu com os três modos, marcando o que está em uso.
	 *
	 * Menu em vez de abas porque isto não é navegação — ela escolhe uma vez e esquece. Abas no topo
	 * roubariam a linha inteira para uma decisão que muda de mês em mês.
	 */
	private desenharSeletorAgrupamento(pai: HTMLElement): void {
		const efetivo = this.agrupamentoEfetivo;

		const rotulos: Record<ModoAgrupamento, string> = {
			secao: "Por seção do arquivo",
			prefixo: "Por prefixo do nome",
			estrutura: this.formato === "css" ? "Por seletor CSS" : "Pela estrutura do arquivo",
		};

		const botao = botaoIcone(pai, "group", `Agrupar: ${rotulos[efetivo]}`, () => {});

		botao.addEventListener("click", (evento) => {
			const menu = new Menu();

			for (const modo of ["secao", "prefixo", "estrutura"] as ModoAgrupamento[]) {
				const disponivel = modoDisponivel(this.camposDaAba, modo);

				menu.addItem((item) => {
					item
						.setTitle(rotulos[modo])
						.setChecked(modo === efetivo)
						// Um modo que não se aplica a este arquivo aparece apagado em vez de sumir: some,
						// ela acharia que o plugin perdeu a opção; apagado, ela entende que falta o
						// cabeçalho de seção no arquivo.
						.setDisabled(!disponivel)
						.onClick(async () => {
							if (!disponivel) return;
							this.plugin.configuracoes.agrupamento = modo;
							await this.plugin.salvarConfiguracoes();
							this.desenhar();
						});
				});
			}

			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle("Escreva /* === Nome === */ no arquivo para criar seções")
					.setIcon("info")
					.setDisabled(true)
			);

			menu.showAtMouseEvent(evento);
		});
	}

	/**
	 * Uma linha explicando o que aquela lista é e o que fazer nela.
	 *
	 * Pedido dela: *"adicionar também alguma informação do que faz cada coisa, alguma orientação do
	 * ladinho"*. A distinção token/elemento é óbvia para quem construiu o plugin e não é para quem
	 * abre a tela — e sem entendê-la, os controles parecem repetidos entre as duas abas.
	 *
	 * É dispensável: o `×` a esconde para sempre. Uma explicação que não some vira ruído depois da
	 * terceira vez que ela lê.
	 */
	private desenharOrientacao(onde: HTMLElement, qual: "tokens" | "elementos"): void {
		if (this.plugin.configuracoes.esconderOrientacao) return;

		const textos = {
			tokens: {
				titulo: "Os valores que se repetem pelo arquivo",
				texto: "Cada linha é uma variável CSS. Mudar uma aqui muda em todo lugar que a usa — é o jeito de trocar a cor da marca inteira de uma vez.",
			},
			elementos: {
				titulo: "O que cada parte da página usa",
				texto: "Cada linha é uma propriedade de uma regra. Quando o valor é uma variável, aparece a ficha dela — clique para editar sem sair daqui. Quando é um valor solto, o botão de corrente troca por uma variável ou cria uma nova.",
			},
		};

		const conteudo = textos[qual];

		const caixa = onde.createDiv({ cls: "ve-orientacao" });
		setIcon(caixa.createDiv({ cls: "ve-orientacao-icone" }), "lightbulb");

		const corpo = caixa.createDiv({ cls: "ve-orientacao-corpo" });
		corpo.createDiv({ cls: "ve-orientacao-titulo", text: conteudo.titulo });
		corpo.createDiv({ cls: "ve-orientacao-texto", text: conteudo.texto });

		const fechar = caixa.createEl("button", {
			cls: "ve-orientacao-fechar",
			attr: { type: "button", "aria-label": "Não mostrar mais estas explicações" },
		});
		setIcon(fechar, "x");
		fechar.addEventListener("click", async () => {
			this.plugin.configuracoes.esconderOrientacao = true;
			await this.plugin.salvarConfiguracoes();
			this.desenhar();
		});
	}

	/** O filtro de busca aplicado a uma lista qualquer. */
	private aplicarFiltro(campos: Campo[]): Campo[] {
		if (!this.filtro) return campos;

		return campos.filter(
			(campo) =>
				campo.rotulo.toLowerCase().includes(this.filtro) ||
				campo.chave.toLowerCase().includes(this.filtro) ||
				campo.grupo.toLowerCase().includes(this.filtro) ||
				// Buscar pelo nome da variável usada acha "quem usa --cor-primaria", que é a
				// pergunta natural na aba de elementos.
				(campo.variaveisUsadas ?? []).some((v) => v.toLowerCase().includes(this.filtro))
		);
	}

	/** Desenha uma lista agrupada em seções dentro de um container. */
	private desenharLista(onde: HTMLElement, campos: Campo[], modo: ModoAgrupamento): void {
		for (const [grupo, lista] of agrupar(campos, modo)) {
			const secao = onde.createDiv({ cls: "ve-secao" });
			secao.createDiv({ cls: "ve-secao-titulo", text: humanizar(grupo) });

			for (const campo of lista) {
				this.desenharCampo(secao, campo);
			}
		}
	}

	/**
	 * As duas listas lado a lado.
	 *
	 * Cada coluna rola por conta própria: uma rolagem só faria a lista curta terminar no meio da
	 * tela enquanto a longa continua, e o par perderia o sentido.
	 */
	private desenharEmparelhado(): void {
		const grade = this.corpo.createDiv({ cls: "ve-emparelhado" });

		const coluna = (
			titulo: string,
			qual: "tokens" | "elementos",
			campos: Campo[],
			modo: ModoAgrupamento
		) => {
			const el = grade.createDiv({ cls: "ve-coluna" });
			const cabecalho = el.createDiv({ cls: "ve-coluna-titulo" });
			cabecalho.createSpan({ text: titulo });
			cabecalho.createSpan({ cls: "ve-coluna-contagem", text: String(campos.length) });

			const corpo = el.createDiv({ cls: "ve-coluna-corpo" });
			this.desenharOrientacao(corpo, qual);

			if (campos.length === 0) {
				corpo.createDiv({
					cls: "ve-vazio",
					text: this.filtro ? `Nada para "${this.filtro}".` : "Nada aqui.",
				});
				return;
			}

			this.desenharLista(corpo, campos, modo);
		};

		coluna("Tokens", "tokens", this.aplicarFiltro(this.tokens), this.agrupamentoDeTokens);
		coluna("Elementos", "elementos", this.aplicarFiltro(this.elementos), "estrutura");
	}

	private desenharCampos(): void {
		if (this.camposDaAba.length === 0) {
			this.desenharVazio();
			return;
		}

		this.desenharOrientacao(this.corpo, this.aba === "elementos" ? "elementos" : "tokens");

		const visiveis = this.aplicarFiltro(this.camposDaAba);

		if (visiveis.length === 0) {
			this.corpo.createDiv({
				cls: "ve-vazio",
				text: `Nenhum controle encontrado para "${this.filtro}".`,
			});
			return;
		}

		this.desenharLista(this.corpo, visiveis, this.agrupamentoEfetivo);

		if (this.naoEditaveis > 0) {
			const nota = this.corpo.createDiv({ cls: "ve-nota" });
			setIcon(nota.createSpan({ cls: "ve-nota-icone" }), "info");
			nota.createSpan({
				text:
					this.naoEditaveis === 1
						? "Há 1 trecho neste arquivo que a interface não edita — ele fica intacto ao salvar."
						: `Há ${this.naoEditaveis} trechos neste arquivo que a interface não edita — eles ficam intactos ao salvar.`,
			});
		}

		// Com "mostrar os elementos" desligado, as regras existem e não estão à vista. Dizer isso
		// evita que a nota acima (que fala de 3 ou 4 trechos) passe a impressão de que o arquivo é
		// menor do que é.
		const ocultos = this.plugin.configuracoes.mostrarElementos
			? 0
			: this.campos.filter((campo) => campo.papel === "propriedade").length;

		if (ocultos > 0) {
			const nota = this.corpo.createDiv({ cls: "ve-nota" });
			setIcon(nota.createSpan({ cls: "ve-nota-icone" }), "eye-off");
			nota.createSpan({
				text: `${ocultos} ${ocultos === 1 ? "propriedade de regra está oculta" : "propriedades de regras estão ocultas"} — ligue “Mostrar os elementos” nas configurações para vê-las.`,
			});
		}
	}

	/**
	 * Acima de quantos caracteres a descrição é recolhida atrás do (i).
	 *
	 * Uma descrição curta ("o que flutua acima de tudo") é rótulo: ajuda sem atrapalhar. Uma longa é
	 * ensaio — e expandida em coluna estreita ela estica a linha para uma dúzia de alturas, jogando
	 * o controle para o meio de um paredão de texto e destruindo a leitura da lista.
	 */
	private static readonly LIMITE_DESCRICAO = 90;

	private desenharCampo(pai: HTMLElement, campo: Campo): void {
		const linha = pai.createDiv({ cls: "ve-campo" });
		// A chave marca a linha para o "ir para o token" achá-la depois de trocar de aba.
		linha.setAttr("data-chave", campo.chave);

		const rotulo = linha.createDiv({ cls: "ve-campo-rotulo" });

		const cabecalho = rotulo.createDiv({ cls: "ve-campo-cabecalho" });
		// Numa propriedade o nome exato do CSS é o que ela reconhece — "box-shadow", não "Box shadow".
		// Num token o humanizado lê melhor, e o nome real fica no `title` da linha.
		cabecalho.createSpan({
			cls: "ve-campo-nome",
			text: campo.papel === "propriedade" ? (campo.propriedade ?? campo.rotulo) : campo.rotulo,
		});

		const descricao = campo.descricao;
		const longa = descricao !== undefined && descricao.length > VistaVisual.LIMITE_DESCRICAO;

		if (descricao && !longa) {
			rotulo.createDiv({ cls: "ve-campo-descricao", text: descricao });
		}

		// Num token sem comentário, quem o USA é a melhor descrição disponível.
		//
		// Pedido dela olhando uma lista de `--spacing-1` a `--spacing-8`: *"eu tenho várias opções de
		// espaço, mas eu não sei do que se trata cada um"*. O nome não distingue, o valor quase não
		// (16px vs 20px), mas "usado no padding do .card" distingue na hora.
		if (campo.papel !== "propriedade" && !descricao) {
			this.desenharQuemUsa(rotulo, campo);
		}

		if (descricao && longa) {
			const alternar = cabecalho.createEl("button", {
				cls: "ve-campo-info",
				attr: { type: "button", "aria-label": "Ver a explicação", "aria-expanded": "false" },
			});
			setIcon(alternar, "info");

			const texto = rotulo.createDiv({ cls: "ve-campo-descricao ve-campo-descricao-longa" });
			texto.setText(descricao);
			texto.hide();

			alternar.addEventListener("click", () => {
				const aberto = alternar.getAttr("aria-expanded") === "true";
				alternar.setAttr("aria-expanded", String(!aberto));
				alternar.toggleClass("is-ativo", !aberto);
				if (aberto) texto.hide();
				else texto.show();
			});
		}

		// O nome real fica no title: o rótulo humanizado é bom para ler, mas na hora de casar com o
		// código ela precisa do nome exato da variável.
		rotulo.setAttr("title", campo.nomeReal);

		// A sombra tem controles empilhados e não cabe na coluna da direita de uma linha comum: a
		// linha inteira passa a ser dela, com o rótulo acima.
		if (campo.tipo === "sombra") linha.addClass("is-largo");

		// Numa propriedade ligada a uma variável, o valor não é dela: é do token. Editar aqui
		// trocaria `var(--x)` por um literal e desfaria a ligação sem ela pedir — então a linha mostra
		// a ligação e leva ao token, em vez de oferecer um controle que mente.
		const ligada = (campo.variaveisUsadas ?? []).length > 0;

		if (campo.papel === "propriedade" && ligada) {
			this.desenharLigacao(linha, campo);
		} else {
			desenharControle(linha, campo, (novo) => this.aplicar(campo, novo));
		}

		if (campo.papel === "propriedade") {
			this.desenharAcoesVariavel(linha, campo, ligada);
		}
	}

	/**
	 * O valor de uma propriedade que já usa variável: as fichas das variáveis, clicáveis.
	 *
	 * Clicar leva ao token na aba Tokens — é o caminho de "quero mudar isto" para "isto se muda lá".
	 * `padding: var(--sm) var(--lg)` mostra as duas.
	 */
	private desenharLigacao(pai: HTMLElement, campo: Campo): void {
		const caixa = pai.createDiv({ cls: "ve-controle ve-controle-ligacao" });

		for (const nome of campo.variaveisUsadas ?? []) {
			const alvo = this.tokens.find((token) => token.nomeReal === nome);

			const ficha = caixa.createEl("button", {
				cls: "ve-ficha-var",
				attr: {
					type: "button",
					"aria-label": alvo ? `Ir para ${nome}` : `${nome} não é declarada neste arquivo`,
				},
			});

			// Uma amostra da cor na própria ficha: numa lista de regras, é o que deixa ver de relance
			// que `--cor-primaria` é o vermelho, sem abrir o token.
			if (alvo?.tipo === "cor") {
				const ponto = ficha.createDiv({ cls: "ve-ficha-ponto" });
				ponto.style.background = alvo.valor;
			}

			ficha.createSpan({ cls: "ve-ficha-nome", text: nome });
			if (alvo) ficha.createSpan({ cls: "ve-ficha-valor", text: alvo.valor });

			// Variável usada mas não declarada aqui: costuma vir de outro arquivo, e não é erro. Fica
			// marcada para ela saber que não adianta procurar na aba Tokens.
			if (!alvo) ficha.addClass("is-externa");

			ficha.addEventListener("click", () => {
				if (!alvo) {
					new Notice(`${nome} não é declarada neste arquivo.`);
					return;
				}
				// A janelinha em vez da troca de aba: editar o token sem perder o lugar na lista de
				// regras. Ver `popover-token.ts`.
				this.popover.abrir(
					ficha,
					alvo,
					this.usosDe(alvo.nomeReal),
					(novo) => this.aplicar(alvo, novo),
					() => this.irParaToken(alvo)
				);
			});
		}

		// O valor cru fica no title: `padding: var(--sm) var(--lg)` tem texto entre as fichas que as
		// fichas sozinhas não mostram.
		caixa.setAttr("title", campo.valor);
	}

	/**
	 * "usado em .card · padding" abaixo do nome do token.
	 *
	 * É a resposta para uma lista de `--spacing-1` a `--spacing-8`, onde nem o nome nem o valor
	 * dizem qual é qual. Mostra os dois primeiros usos e resume o resto — a lista inteira roubaria a
	 * linha, e a janelinha do token já a tem completa.
	 *
	 * Um token que ninguém usa neste arquivo também é informação: costuma ser tema escuro, override
	 * de media query, ou variável que sobrou de uma refatoração.
	 */
	private desenharQuemUsa(onde: HTMLElement, token: Campo): void {
		const usos = this.usosDe(token.nomeReal);
		if (usos.length === 0) return;

		const linha = onde.createDiv({ cls: "ve-campo-usos" });

		// Na linha, só a propriedade e o seletor mais interno: `@media (…) › .card · padding` não cabe
		// e o que ela precisa saber é "isto é o padding do card".
		const curtos = usos.map((uso) => uso.split(" › ").pop() ?? uso);
		const unicos = [...new Set(curtos)];

		const mostrados = unicos.slice(0, 2).join(", ");
		linha.setText(unicos.length > 2 ? `${mostrados} e mais ${unicos.length - 2}` : mostrados);
		// O `title` traz a lista inteira, para quando os dois primeiros não bastarem.
		linha.setAttr("title", `Usado em:\n${usos.join("\n")}`);
	}

	/**
	 * Onde um token é usado, em texto legível: `.card`, `@media … › .botao`.
	 *
	 * É o que a janelinha mostra abaixo do controle — responde "se eu mexer aqui, o que mais muda?",
	 * pergunta que o valor sozinho não responde.
	 */
	private usosDe(nome: string): string[] {
		const usos = this.campos
			.filter((campo) => campo.papel === "propriedade" && (campo.variaveisUsadas ?? []).includes(nome))
			.map((campo) => `${campo.seletor} · ${campo.propriedade}`);

		return [...new Set(usos)];
	}

	/** Leva para o token na aba Tokens, filtrando por ele e destacando a linha. */
	private irParaToken(token: Campo): void {
		this.aba = "tokens";
		this.filtro = "";
		this.desenhar();

		const alvo = this.corpo.querySelector(`[data-chave="${CSS.escape(token.chave)}"]`);
		if (!(alvo instanceof HTMLElement)) return;

		alvo.scrollIntoView({ block: "center", behavior: "smooth" });
		// O destaque é temporário: some sozinho depois de ela achar a linha.
		alvo.addClass("is-destacado");
		window.setTimeout(() => alvo.removeClass("is-destacado"), 1600);
	}

	/**
	 * O botão de ligar a uma variável / extrair para variável, no fim da linha da propriedade.
	 *
	 * É a resposta ao pedido dela de "atribuir variáveis a elementos". Uma ação explícita e nunca um
	 * efeito colateral de mexer num controle: extrair ACRESCENTA linha ao arquivo, e essa é a única
	 * operação do plugin que faz isso.
	 */
	private desenharAcoesVariavel(pai: HTMLElement, campo: Campo, ligada: boolean): void {
		const botao = botaoIcone(
			pai,
			ligada ? "unlink" : "link",
			ligada ? "Desfazer a ligação ou trocar a variável" : "Usar uma variável aqui",
			() => {}
		);
		botao.addClass("ve-acao-var");

		botao.addEventListener("click", (evento) => {
			const menu = new Menu();

			const compativeis = variaveisCompativeis(campo, this.tokens);
			const jaUsadas = campo.variaveisUsadas ?? [];

			if (!ligada) {
				menu.addItem((item) =>
					item
						.setTitle("Extrair para uma variável nova…")
						.setIcon("plus")
						.onClick(() => this.pedirNomeEExtrair(campo))
				);
				if (compativeis.length > 0) menu.addSeparator();
			}

			for (const variavel of compativeis.slice(0, 24)) {
				const emUso = jaUsadas.includes(variavel.nomeReal);
				menu.addItem((item) =>
					item
						.setTitle(`${variavel.nomeReal}  ·  ${variavel.valor}`)
						.setChecked(emUso)
						.onClick(() => {
							if (emUso) return;
							this.ligar(campo, variavel.nomeReal);
						})
				);
			}

			if (ligada) {
				menu.addSeparator();
				menu.addItem((item) =>
					item
						.setTitle("Substituir pelo valor atual")
						.setIcon("unlink")
						.onClick(() => this.desfazerLigacao(campo))
				);
			}

			menu.showAtMouseEvent(evento);
		});
	}

	private desenharVazio(): void {
		const vazio = this.corpo.createDiv({ cls: "ve-vazio-completo" });
		setIcon(vazio.createDiv({ cls: "ve-vazio-icone" }), "sliders-horizontal");

		const explicacao: Record<Formato, string> = {
			css: this.plugin.configuracoes.mostrarElementos
				? "Este arquivo não tem variáveis CSS (`--nome: valor`) nem regras de estilo. Declare variáveis num bloco `:root` e elas aparecem aqui."
				: "Este arquivo não tem variáveis CSS (`--nome: valor`). O editor visual mostra os controles a partir delas — declare as suas num bloco `:root`, ou ligue “Mostrar os elementos” nas configurações para editar as regras.",
			json: "Este arquivo não tem valores que o editor consiga mostrar como controles.",
			texto: "Este arquivo não tem linhas no formato `chave = valor`.",
		};

		vazio.createDiv({ cls: "ve-vazio-titulo", text: "Nenhum controle para mostrar" });
		vazio.createDiv({ cls: "ve-vazio-texto", text: explicacao[this.formato] });
	}

	/**
	 * Modo código: o texto integral numa textarea.
	 *
	 * Existe por confiança — ela pode conferir a qualquer momento que o plugin mexeu só no que devia.
	 * Editar aqui também funciona, e ao sair do campo os controles são relidos do novo texto.
	 */
	private desenharCodigo(): void {
		const area = this.corpo.createEl("textarea", {
			cls: "ve-codigo",
			attr: { spellcheck: "false" },
		});
		area.value = this.texto;

		area.addEventListener("blur", () => {
			if (area.value === this.texto) return;
			this.texto = area.value;

			const documento = ler(this.texto, this.formato);
			this.campos = documento.campos;
			this.naoEditaveis = documento.naoEditaveis;

			this.salvarAdiado();
			this.desenhar();
		});
	}

	// -------------------------------------------------------------------------------------------
	// Edição
	// -------------------------------------------------------------------------------------------

	/** Liga a propriedade a uma variável existente. Não acrescenta linha: é troca de valor. */
	private ligar(campo: Campo, nome: string): void {
		const resultado = ligarVariavel(this.texto, campo, nome);
		if (!resultado.ok) {
			new Notice(resultado.erro ?? "Não foi possível ligar a variável.");
			return;
		}
		this.adotarTexto(resultado.texto);
	}

	/**
	 * Desfaz a ligação: `var(--x)` volta a ser o valor literal do token.
	 *
	 * Sem o token declarado no arquivo não dá para resolver o valor — e escrever qualquer outra coisa
	 * mudaria a aparência da página. Melhor recusar e dizer por quê.
	 */
	private desfazerLigacao(campo: Campo): void {
		const nomes = campo.variaveisUsadas ?? [];
		if (nomes.length !== 1) {
			new Notice("Esta propriedade usa mais de uma variável — desfaça pelo modo código.");
			return;
		}

		const token = this.tokens.find((t) => t.nomeReal === nomes[0]);
		if (!token) {
			new Notice(`${nomes[0]} não é declarada neste arquivo, então não dá para resolver o valor.`);
			return;
		}

		// Só troca quando o valor é exatamente `var(--x)`. Um `calc(var(--x) * 2)` resolvido na marra
		// mudaria o resultado — e este botão não é lugar de fazer conta.
		if (campo.valor.trim() !== `var(${token.nomeReal})`) {
			new Notice("O valor tem mais coisa além da variável — desfaça pelo modo código.");
			return;
		}

		this.aplicar(campo, token.valor);
	}

	/** Pergunta o nome e extrai. O nome é sugerido a partir da regra e da propriedade. */
	private pedirNomeEExtrair(campo: Campo): void {
		const declaradas = this.tokens.map((token) => token.nomeReal);
		const sugestao = sugerirNome(campo, declaradas);

		new ModalNomeVariavel(this.app, sugestao, declaradas, (nome) => {
			const resultado = extrairVariavel(this.texto, campo, nome, declaradas);
			if (!resultado.ok) {
				new Notice(resultado.erro ?? "Não foi possível extrair a variável.");
				return;
			}
			this.adotarTexto(resultado.texto);
			new Notice(`${nome} criada no :root.`);
		}).open();
	}

	/**
	 * Adota um texto novo vindo de uma operação que mexeu na ESTRUTURA do arquivo.
	 *
	 * Diferente de `aplicar`: aqui os deslocamentos de todos os campos mudaram (uma linha foi
	 * inserida), então relemos tudo antes de redesenhar.
	 */
	private adotarTexto(texto: string): void {
		this.texto = texto;

		const documento = ler(this.texto, this.formato);
		this.campos = documento.campos;
		this.naoEditaveis = documento.naoEditaveis;

		this.salvarAdiado();
		this.desenhar();
	}

	/**
	 * Aplica um valor novo e agenda o salvamento.
	 *
	 * Depois de reescrever, o arquivo é RELIDO: trocar `8px` por `100px` desloca tudo o que vem
	 * depois, e os `inicio`/`fim` dos outros campos precisam ser recalculados. Sem reler, a segunda
	 * edição da sessão gravaria no lugar errado.
	 */
	private aplicar(campo: Campo, novo: string): void {
		const anterior = this.texto;

		try {
			this.texto = escrever(this.texto, this.campos, new Map([[campo.chave, novo]]), this.formato);
		} catch (erro) {
			this.texto = anterior;
			new Notice(`Não foi possível aplicar a mudança: ${erro instanceof Error ? erro.message : erro}`);
			return;
		}

		const documento = ler(this.texto, this.formato);
		this.campos = documento.campos;
		this.naoEditaveis = documento.naoEditaveis;

		this.salvarAdiado();

		// A tela é redesenhada para os deslocamentos novos valerem nos controles. É barato: são
		// dezenas de elementos, não milhares.
		//
		// A janelinha é fechada antes: ela está ancorada numa ficha que o redesenho destrói, e
		// mantê-la aberta a deixaria apontando para um elemento que não existe mais. O gesto dela
		// (escolher uma cor) já terminou quando isto roda.
		this.popover.fechar();
		this.desenhar();
	}
}
