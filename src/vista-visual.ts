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
import { abrirAcordeao, criarAcordeao } from "./acordeao";
import { explicarSeletor } from "./explicar-seletor";
import { Historico } from "./historico";
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

	/** A janelinha que explica um seletor, aberta pelo (i) do cabeçalho de um grupo. */
	private popoverSeletor = new PopoverToken();

	/**
	 * Desfazer/refazer próprio.
	 *
	 * O Ctrl+Z do Obsidian é do editor de texto, e esta view não é um — não havia nada para ele
	 * desfazer. Ver `historico.ts`.
	 */
	private historico = new Historico();


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

		// O histórico é reiniciado só quando o texto vem de FORA — abrir o arquivo, ou ele mudar no
		// disco pelo editor de código dela.
		//
		// A distinção é feita comparando com o passo atual, e não com uma marca temporal: o
		// salvamento é adiado em 400ms, então qualquer "estou aplicando agora" que se desligasse por
		// tempo teria de adivinhar quando o `setViewData` de volta chega. Comparar o conteúdo é exato
		// — se o texto que chegou é o que já temos, não é mudança externa, seja qual for o atraso.
		if (dados !== this.historico.atual) {
			this.historico.iniciar(dados);
		}

		this.desenhar();
	}

	clear(): void {
		this.texto = "";
		this.campos = [];
		this.naoEditaveis = 0;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("visual-editor-vista");

		/*
			Ctrl+Z / Ctrl+Shift+Z dentro da view.

			O atalho do Obsidian pertence ao editor de texto (CodeMirror), e esta view não é um — por
			isso ele "não funcionava": não havia histórico para desfazer, nem quem escutasse a tecla.

			O ouvinte é do `contentEl`, não do documento: fora da aba, o Ctrl+Z tem de continuar
			desfazendo o que quer que ela esteja fazendo. E o modo código é exceção — lá a textarea tem
			o desfazer nativo do navegador, que é o certo para digitação.
		*/
		this.contentEl.addEventListener("keydown", (evento) => {
			if (!(evento.ctrlKey || evento.metaKey) || evento.key.toLowerCase() !== "z") return;
			if (this.modoCodigo) return;

			// Num campo de texto, o Ctrl+Z do navegador desfaz a digitação — mais útil ali do que
			// reverter o arquivo inteiro.
			const alvo = evento.target;
			if (alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement) {
				if (alvo.type !== "range" && alvo.type !== "color") return;
			}

			evento.preventDefault();
			if (evento.shiftKey) this.refazer();
			else this.desfazer();
		});
	}

	async onClose(): Promise<void> {
		// A janelinha vive no `body`, fora do `contentEl`: esvaziar a view não a levaria junto, e ela
		// ficaria órfã na tela depois de fechar a aba.
		this.popover.fechar();
		this.popoverSeletor.fechar();
		this.contentEl.empty();
	}

	// -------------------------------------------------------------------------------------------
	// Desenho
	// -------------------------------------------------------------------------------------------

	private desenhar(): void {
		/*
			A rolagem é guardada e devolvida porque `desenhar()` roda a cada gravação — sem isso, mexer
			num controle lá embaixo joga a tela de volta ao topo a cada ajuste.

			Dois detalhes que fizeram isso falhar antes, e que ela relatou como "toda vez que eu edito,
			o arquivo volta pro topo":

			1. **Quem rola nem sempre é o `.ve-corpo`.** No modo emparelhado o corpo tem
			   `overflow: hidden` e quem rola são as colunas. Guardar só o corpo perdia a posição.
			2. **Devolver a rolagem no mesmo quadro não funciona.** Os elementos acabaram de ser criados
			   e o navegador ainda não calculou a altura; atribuir `scrollTop = 300` num container que
			   ainda mede 0 de altura rolável resulta em 0. Por isso a devolução espera o próximo quadro.
		*/
		const rolagens = this.lerRolagens();

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

		this.devolverRolagens(rolagens);
	}

	/** A rolagem do corpo e a de cada coluna do modo emparelhado. */
	private lerRolagens(): { corpo: number; colunas: number[] } {
		const colunas = this.corpo
			? Array.from(this.corpo.querySelectorAll(".ve-coluna-corpo")).map((el) =>
					el instanceof HTMLElement ? el.scrollTop : 0
				)
			: [];

		return { corpo: this.corpo?.scrollTop ?? 0, colunas };
	}

	private devolverRolagens(rolagens: { corpo: number; colunas: number[] }): void {
		const aplicar = () => {
			if (!this.corpo) return;

			this.corpo.scrollTop = rolagens.corpo;

			const colunas = this.corpo.querySelectorAll(".ve-coluna-corpo");
			colunas.forEach((el, i) => {
				if (el instanceof HTMLElement && rolagens.colunas[i] !== undefined) {
					el.scrollTop = rolagens.colunas[i];
				}
			});
		};

		// Uma vez agora (cobre o caso em que o layout já está válido, evitando um piscar) e outra no
		// próximo quadro, quando as alturas estão calculadas e a atribuição pega de verdade.
		aplicar();
		requestAnimationFrame(aplicar);
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

		// Desfazer/refazer. O Ctrl+Z do Obsidian não alcança esta view — ele é do editor de texto —,
		// então os botões são o caminho principal, e o atalho é reimplementado abaixo.
		const desfazer = botaoIcone(
			direita,
			"undo-2",
			this.historico.podeDesfazer
				? `Desfazer: ${this.historico.rotuloDesfazer} (Ctrl+Z)`
				: "Nada para desfazer",
			() => this.desfazer()
		);
		desfazer.toggleClass("is-inativo", !this.historico.podeDesfazer);

		const refazer = botaoIcone(
			direita,
			"redo-2",
			this.historico.podeRefazer
				? `Refazer: ${this.historico.rotuloRefazer} (Ctrl+Shift+Z)`
				: "Nada para refazer",
			() => this.refazer()
		);
		refazer.toggleClass("is-inativo", !this.historico.podeRefazer);

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

	/**
	 * Desenha uma lista agrupada em seções dentro de um container.
	 *
	 * Cada grupo é um acordeão: um `global.css` de verdade rende 117 tokens, e rolar tudo para achar
	 * um grupo foi o que ela relatou. Recolher devolve o índice da página — ela vê os nomes das
	 * seções e abre a que quer.
	 *
	 * Quando há UM grupo só, o acordeão não aparece: recolher a única seção esconderia a tela
	 * inteira atrás de um clique, sem nada a ganhar.
	 */
	private desenharLista(onde: HTMLElement, campos: Campo[], modo: ModoAgrupamento): void {
		// Os grupos de elementos vão em ordem alfabética; os de tokens ficam na ordem do arquivo, que
		// é intencional (cores juntas, espaçamentos em escala). Ver `agrupar`.
		const ehListaDeElementos = campos[0]?.papel === "propriedade";
		const grupos = [...agrupar(campos, modo, ehListaDeElementos)];

		if (grupos.length === 1) {
			const secao = onde.createDiv({ cls: "ve-secao" });
			secao.createDiv({ cls: "ve-secao-titulo", text: humanizar(grupos[0][0]) });
			for (const campo of grupos[0][1]) this.desenharCampo(secao, campo);
			return;
		}

		for (const [grupo, lista] of grupos) {
			const chave = `${this.file?.path ?? ""}|${modo}|${grupo}`;

			// Durante uma busca, força a abertura mesmo dos grupos que ela tinha fechado antes:
			// `abertoPorPadrao` só vale na primeira vez que a chave aparece, e um resultado escondido
			// atrás de um acordeão fechado é um resultado que ela não acha.
			if (this.filtro) abrirAcordeao(chave);

			// Num grupo de ELEMENTOS o título é um seletor CSS, que não se humaniza: `.controle-quadrado`
			// tem de continuar assim, com o ponto, senão ela não o reconhece no arquivo.
			const ehSeletor = lista[0]?.papel === "propriedade";

			const acordeao = criarAcordeao(onde, {
				chave,
				titulo: ehSeletor ? grupo : humanizar(grupo),
				resumo: String(lista.length),
				// Durante uma busca tudo nasce aberto: obrigar a abrir grupo por grupo até o acerto
				// anularia o motivo de ter buscado.
				abertoPorPadrao: this.filtro !== "" || grupos.length <= 3,
			});

			// O (i) que explica QUANDO a regra vale — pedido dela olhando uma lista de seletores
			// longos, sem saber o que cada um significa.
			if (ehSeletor) this.desenharInfoSeletor(acordeao.cabecalho, grupo);

			acordeao.sePreenchido((corpo) => {
				for (const campo of lista) this.desenharCampo(corpo, campo);
			});
		}
	}

	/**
	 * O (i) no cabeçalho de um grupo de elementos, explicando quando a regra vale.
	 *
	 * Pedido dela: *"tem como colocar um ícone de informação e informar em quais páginas ele
	 * aparece?"*. Em quais páginas, o CSS não sabe — um arquivo de estilos não guarda onde cada
	 * regra é usada. O que ele sabe é a CONDIÇÃO, e na prática ela responde à mesma pergunta:
	 * `@media (width >= 48rem) › .controle-quadrado` só vale em telas de 768px ou mais.
	 *
	 * O texto abre num popover em vez de embaixo do título: o cabeçalho é um `<button>` que
	 * abre/fecha a seção, e conteúdo dentro dele herdaria esse clique.
	 */
	private desenharInfoSeletor(cabecalho: HTMLElement, seletor: string): void {
		const partes = explicarSeletor(seletor);
		// Sem nenhuma tradução, o (i) não teria o que dizer além de repetir o título.
		if (!partes.some((parte) => parte.explicacao)) return;

		const acoes = cabecalho.createDiv({ cls: "ve-acordeao-acoes" });

		const botao = acoes.createEl("button", {
			cls: "ve-campo-info ve-seletor-info",
			attr: { type: "button", "aria-label": "Quando esta regra vale" },
		});
		setIcon(botao, "info");

		botao.addEventListener("click", (evento) => {
			// Sem isto o clique subiria para o cabeçalho e abriria/fecharia a seção junto.
			evento.stopPropagation();
			this.popoverSeletor.abrirSeletor(botao, seletor, partes);
		});
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

		/*
			Tudo o que EXPLICA o campo fica atrás do mesmo (i).

			Antes eram três tratamentos diferentes para a mesma função: descrição curta solta embaixo do
			nome, descrição longa atrás do (i), e "usado em" solto embaixo também. Pedido dela: *"quando
			tiver esses textinhos assim embaixo, coloca o iconezinho de informação do lado pra aparecer
			igual aos outros"*. Um padrão só deixa a lista alinhada e a altura das linhas previsível.
		*/
		const descricao = campo.descricao;

		// Num token sem comentário, quem o USA é a melhor descrição disponível: numa lista de
		// `--spacing-1` a `--spacing-8`, nem o nome nem o valor distinguem, mas "o padding do .card"
		// distingue na hora.
		const usos = campo.papel !== "propriedade" && !descricao ? this.usosDe(campo.nomeReal) : [];

		if (descricao || usos.length > 0) {
			this.desenharInfo(cabecalho, rotulo, descricao, usos);
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
	/**
	 * O (i) ao lado do nome, e o texto que ele abre.
	 *
	 * Um só caminho para as duas coisas que explicam um campo — o comentário que ela escreveu no
	 * arquivo e a lista de quem usa o token. Ficam recolhidos: uma descrição de doze linhas aberta
	 * por padrão estica a linha e joga o controle para o meio de um paredão de texto, e uma lista de
	 * usos embaixo de cada nome faz a lista inteira crescer sem que ela tenha pedido.
	 */
	private desenharInfo(
		cabecalho: HTMLElement,
		rotulo: HTMLElement,
		descricao: string | undefined,
		usos: string[]
	): void {
		const alternar = cabecalho.createEl("button", {
			cls: "ve-campo-info",
			attr: {
				type: "button",
				"aria-label": descricao ? "Ver a explicação" : "Ver onde é usado",
				"aria-expanded": "false",
			},
		});
		setIcon(alternar, "info");

		const caixa = rotulo.createDiv({ cls: "ve-campo-info-texto" });
		caixa.hide();

		if (descricao) {
			caixa.createDiv({ cls: "ve-campo-descricao", text: descricao });
		}

		if (usos.length > 0) {
			this.desenharQuemUsa(caixa, usos);
		}

		alternar.addEventListener("click", () => {
			const aberto = alternar.getAttr("aria-expanded") === "true";
			alternar.setAttr("aria-expanded", String(!aberto));
			alternar.toggleClass("is-ativo", !aberto);
			if (aberto) caixa.hide();
			else caixa.show();
		});
	}

	/**
	 * A lista de onde o token é usado, dentro do (i).
	 *
	 * Recolhida, cabe a lista INTEIRA — não há mais o corte em dois que a versão em linha precisava
	 * para não estourar a largura do rótulo.
	 */
	private desenharQuemUsa(onde: HTMLElement, usos: string[]): void {
		if (usos.length === 0) return;

		const bloco = onde.createDiv({ cls: "ve-campo-usos" });
		bloco.createDiv({
			cls: "ve-campo-usos-titulo",
			text: usos.length === 1 ? "Usado em 1 lugar" : `Usado em ${usos.length} lugares`,
		});

		// O seletor mais interno basta: `@media (…) › .card · padding` é comprido e o que importa é
		// "isto é o padding do card". O caminho completo fica no `title` de cada linha.
		for (const uso of usos) {
			const linha = bloco.createDiv({ cls: "ve-campo-uso", text: uso.split(" › ").pop() ?? uso });
			if (uso.includes(" › ")) linha.setAttr("title", uso);
		}
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

	/**
	 * Leva para o token na aba Tokens, abrindo o grupo dele e destacando a linha.
	 *
	 * Três coisas tinham de ser resolvidas para o botão funcionar, e faltavam duas:
	 *
	 * 1. **O grupo do token pode estar fechado.** Desde que os grupos viraram acordeão, o conteúdo
	 *    de uma seção fechada nem é desenhado — o `querySelector` não achava nada e o clique não
	 *    fazia efeito nenhum. Por isso o acordeão do grupo é aberto ANTES de redesenhar.
	 * 2. **No modo emparelhado, trocar de aba não muda nada** (as duas listas já estão à vista), e a
	 *    rolagem é da coluna, não do corpo. `scrollIntoView` resolve os dois casos.
	 * 3. O elemento só existe depois do redesenho, e a rolagem só funciona depois do layout — daí o
	 *    `requestAnimationFrame`.
	 */
	private irParaToken(token: Campo): void {
		if (!this.emparelhadoAtivo) this.aba = "tokens";
		this.filtro = "";

		// Abre o grupo onde o token mora, no modo de agrupamento em vigor para os tokens.
		const modo = this.agrupamentoDeTokens;
		const [[grupo] = [""]] = [...agrupar([token], modo)];
		abrirAcordeao(`${this.file?.path ?? ""}|${modo}|${grupo}`);

		this.desenhar();

		requestAnimationFrame(() => {
			const alvo = this.corpo?.querySelector(`[data-chave="${CSS.escape(token.chave)}"]`);
			if (!(alvo instanceof HTMLElement)) return;

			alvo.scrollIntoView({ block: "center", behavior: "smooth" });
			// O destaque é temporário: some sozinho depois de ela achar a linha.
			alvo.addClass("is-destacado");
			window.setTimeout(() => alvo.removeClass("is-destacado"), 1600);
		});
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
			this.historico.registrar(this.texto, "edição no modo código");

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

	/** Desfaz o último passo. Público para o comando da paleta alcançá-lo. */
	desfazer(): void {
		const passo = this.historico.desfazer();
		if (!passo) {
			new Notice("Nada para desfazer.");
			return;
		}
		this.viajarPara(passo.texto);
		new Notice(`Desfeito: ${passo.rotulo === "Estado inicial" ? "voltou ao início" : passo.rotulo}`);
	}

	refazer(): void {
		const passo = this.historico.refazer();
		if (!passo) {
			new Notice("Nada para refazer.");
			return;
		}
		this.viajarPara(passo.texto);
		new Notice(`Refeito: ${passo.rotulo}`);
	}

	/**
	 * Adota um texto do histórico, sem registrá-lo como passo novo.
	 *
	 * O `Historico` já moveu sua posição; aqui só refletimos o resultado na tela e no arquivo. Como
	 * `setViewData` compara o conteúdo com `historico.atual`, o retorno do salvamento não reinicia
	 * nada.
	 */
	private viajarPara(texto: string): void {
		this.texto = texto;

		const documento = ler(this.texto, this.formato);
		this.campos = documento.campos;
		this.naoEditaveis = documento.naoEditaveis;

		this.popover.fechar();
		this.salvarAdiado();
		this.desenhar();
	}

	/** Liga a propriedade a uma variável existente. Não acrescenta linha: é troca de valor. */
	private ligar(campo: Campo, nome: string): void {
		const resultado = ligarVariavel(this.texto, campo, nome);
		if (!resultado.ok) {
			new Notice(resultado.erro ?? "Não foi possível ligar a variável.");
			return;
		}
		this.adotarTexto(resultado.texto, `ligar ${nome}`);
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
			this.adotarTexto(resultado.texto, `criar ${nome}`);
			new Notice(`${nome} criada no :root.`);
		}).open();
	}

	/**
	 * Adota um texto novo vindo de uma operação que mexeu na ESTRUTURA do arquivo.
	 *
	 * Diferente de `aplicar`: aqui os deslocamentos de todos os campos mudaram (uma linha foi
	 * inserida), então relemos tudo antes de redesenhar.
	 */
	private adotarTexto(texto: string, rotulo = "Mudança"): void {
		this.texto = texto;
		this.historico.registrar(texto, rotulo);

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

		// O rótulo usa o nome que ela vê na tela, para o botão dizer "Desfazer: Cor primária".
		this.historico.registrar(this.texto, campo.papel === "propriedade" ? `${campo.seletor} · ${campo.propriedade}` : campo.rotulo);

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
