import { criarAcordeao } from "./acordeao";
import { Formato } from "./documento";
import {
	AjusteTom,
	PASSOS_LUMINOSIDADE,
	hexParaHsl,
	numeroParaPercentual,
	percentualParaNumero,
	tomCalculado,
} from "./escala-cor";
import { Campo } from "./tipos";

/**
 * A aba Variáveis: o catálogo de valores SOLTOS que vão construir um design system — cores,
 * formatos, sombras e tipografia, sem ainda dizer onde cada um se aplica (isso é uma etapa futura,
 * de combinar variáveis em elementos). Mudança de arquitetura pedida por ela: até a sessão anterior
 * cada papel já nascia amarrado a um componente (Card, Botão…); agora nasce livre, e ela decide o
 * nome — que É o nome do token gravado no CSS, não um apelido à parte.
 *
 * Cada campo nasce com um NOME PROVISÓRIO ("Cor principal 1", "Raio 2"), que já é o token até ela
 * digitar outro por cima — ela confirmou esse fluxo: escolhe o valor primeiro (ou nem escolhe,
 * fica de reserva), o nome provisório já identifica o papel na tela, e ela troca quando quiser.
 * Renomear propaga em cascata: a declaração muda de nome E todo `var(--nome-antigo)` já usado no
 * arquivo passa a apontar para o nome novo (`renomearVariaveis`, em `extrair.ts`) — sem isso, uma
 * variável já usada em alguma regra ficaria quebrada ao ser renomeada.
 */

export interface AcoesDesignSystem {
	/** Grava um valor num token que JÁ existe no arquivo. */
	aplicarToken: (chave: string, novo: string) => void;
	/**
	 * Declara um token que ainda não existe (papel "de reserva"), e o aplica em seguida.
	 * Quando falha (sem `:root`/`@theme` no arquivo), mostra o motivo em vez de falhar em silêncio.
	 */
	criarToken: (nome: string, valorInicial: string) => void;
	/**
	 * Renomeia um ou mais tokens já existentes, propagando para todo uso `var(--nome)` no arquivo —
	 * NUMA PASSADA SÓ (uma leitura, todas as trocas, um redesenho no final). É por isso que aceita
	 * uma lista em vez de um único par: a Sombra tem um nome comandando cinco tokens (`-cor`, `-x`,
	 * `-y`, `-blur`, `-opacidade`), e renomear um por um redesenharia a tela no meio do caminho,
	 * invalidando os `Campo` já capturados para os sufixos seguintes. Devolve `false` quando QUALQUER
	 * um falha (nome inválido, colisão) — nesse caso nada é alterado, nem os que dariam certo.
	 */
	renomearToken: (pares: Array<{ chave: string; nomeAntigo: string; nomeNovo: string }>) => boolean;
	/**
	 * Abre a janelinha de ajuste fino (saturação/luminosidade) de um tom da escala, com botão de
	 * copiar o hex. `aoMudar` devolve o hex recalculado — é o que o botão de copiar mostra e copia.
	 */
	abrirAjusteTom: (
		ancora: HTMLElement,
		rotulo: string,
		valorInicial: AjusteTom,
		hexInicial: string,
		aoMudar: (valor: AjusteTom) => string,
		aoSoltar: (valor: AjusteTom) => void
	) => void;
	/** Abre o seletor de fonte (busca com cada nome escrito na própria tipografia). */
	abrirSeletorFonte: (fontes: string[], aoEscolher: (fonte: string) => void) => void;
}

export function desenharDesignSystem(pai: HTMLElement, campos: Campo[], formato: Formato, acoes: AcoesDesignSystem): void {
	const raiz = pai.createDiv({ cls: "ve-ds" });

	if (formato !== "css") {
		raiz.createDiv({
			cls: "ve-ds-aviso",
			text: "O catálogo de Variáveis só está disponível para arquivos CSS — é onde tokens (--nome: valor) fazem sentido.",
		});
		return;
	}

	const porToken = new Map<string, Campo>();
	for (const campo of campos) {
		if (campo.papel === "propriedade") continue;
		if (!porToken.has(campo.nomeReal)) porToken.set(campo.nomeReal, campo);
	}

	desenharSecaoCoresPrincipais(raiz, porToken, acoes);
	desenharSecaoCoresClaras(raiz, porToken, acoes);
	desenharSecaoCoresEscuras(raiz, porToken, acoes);
	desenharSecaoCoresDestaque(raiz, porToken, acoes);
	desenharSecaoFormato(raiz, porToken, acoes);
	desenharSecaoSombra(raiz, porToken, acoes);
	desenharSecaoTipografia(raiz, porToken, acoes);
}

/**
 * Um SLOT: uma posição fixa dentro de um bloco (ex. "a 3ª cor clara"), identificada pelo nome
 * PROVISÓRIO — não pelo token de verdade, que muda quando ela renomeia. `porToken` é indexado pelo
 * nome REAL atual do token, então achar o campo de um slot é: primeiro tenta o nome provisório
 * (ainda não renomeado), senão cai no que já foi renomeado uma vez — ver `campoDoSlot`.
 */
interface Slot {
	/** O nome provisório, no formato humano ("Cor principal 1") — também a semente do token. */
	nomeProvisorio: string;
}

/** "Cor principal 1" → "--cor-principal-1". Mesma disciplina de `limpar()` em `modal-nome.ts`. */
function tokenDoNome(nome: string): string {
	const limpo = nome
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `--${limpo || "variavel"}`;
}

/**
 * Acha o campo de um slot que ainda não foi renomeado: procura pelo token derivado do nome
 * provisório. Um slot cujo token já mudou de nome (ela renomeou) não é mais achável por aqui — a
 * própria função de renderização de cada bloco guarda o nome ATUAL depois da primeira gravação
 * (ver `desenharCampoNomeavel`, que recebe o nome atual já resolvido pelo chamador).
 */
function campoDoSlot(porToken: Map<string, Campo>, nomeProvisorio: string): Campo | null {
	return porToken.get(tokenDoNome(nomeProvisorio)) ?? null;
}

/** `<input type="color">` recusa valores não-hex (nomes CSS, vazio) — cai num cinza neutro nesses casos. */
function valorParaSeletor(valor: string | undefined): string {
	if (valor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(valor.trim())) return valor.trim();
	return "#8a8da3";
}

/**
 * O pequeno seletor de cor dos cartões: um invólucro `.ve-ds-swatch` (que mostra a cor, a borda e o
 * arredondamento de verdade) com o `<input type="color">` invisível por cima, ocupando os 100% dele —
 * mesmo padrão do `.ve-swatch` principal do plugin (ver `styles.css`). Estilizar o input nativo
 * direto não é confiável: o pseudo-elemento `::-webkit-color-swatch` às vezes desenha um traço fino
 * por dentro em vez de preencher o quadrado.
 */
function criarSeletorCor(pai: HTMLElement, valorInicial: string | undefined): HTMLInputElement {
	const caixa = pai.createDiv({ cls: "ve-ds-swatch" });
	caixa.style.background = valorInicial ?? "var(--background-primary)";
	return caixa.createEl("input", { attr: { type: "color", value: valorParaSeletor(valorInicial) } });
}

/**
 * O cabeçalho comum a todo cartão de variável: um campo de texto editável (não um `<span>`) com o
 * nome atual — provisório até ela digitar outro. Editar dispara `renomearToken` quando o token já
 * existe (o campo tem valor), ou só atualiza o nome provisório local quando ainda não existe nada
 * para renomear (o token nasce com o nome final assim que ela escolher o primeiro valor).
 *
 * `renomear` é opcional: por padrão renomeia só `campoAtual`. A Sombra passa uma versão própria,
 * porque ali UM nome comanda CINCO tokens (`-cor`, `-x`, `-y`, `-blur`, `-opacidade`) — renomear só
 * o de cor deixaria os outros quatro presos ao nome antigo, e a leitura (`sub()`, montada a partir
 * do nome atual) pararia de achá-los.
 *
 * Devolve um getter do nome corrente, para o cartão saber qual token usar ao criar o valor.
 */
function desenharCabecalhoNomeavel(
	pai: HTMLElement,
	nomeInicial: string,
	campoAtual: Campo | null,
	acoes: AcoesDesignSystem,
	renomear?: (novoToken: string) => boolean
): { cabecalho: HTMLElement; nomeAtual: () => string } {
	const cabecalho = pai.createDiv({ cls: "ve-ds-amostra-rotulo" });
	let nome = campoAtual?.nomeReal ? humanoDoToken(campoAtual.nomeReal) : nomeInicial;

	const entrada = cabecalho.createEl("input", {
		cls: "ve-ds-amostra-rotulo-entrada",
		attr: { type: "text", spellcheck: "false", value: nome },
	});

	const confirmar = () => {
		const novoNome = entrada.value.trim();
		if (!novoNome) {
			entrada.value = nome;
			return;
		}
		if (novoNome === nome) return;

		const novoToken = tokenDoNome(novoNome);
		if (!campoAtual) {
			// Token ainda não existe: só o rótulo local muda — o token de verdade nasce com este nome
			// quando ela escolher o valor (cor, raio…), não antes.
			nome = novoNome;
			return;
		}

		const ok = renomear
			? renomear(novoToken)
			: acoes.renomearToken([{ chave: campoAtual.chave, nomeAntigo: campoAtual.nomeReal, nomeNovo: novoToken }]);
		if (ok) nome = novoNome;
		else entrada.value = nome;
	};
	entrada.addEventListener("blur", confirmar);
	entrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entrada.blur();
	});

	return { cabecalho, nomeAtual: () => nome };
}

/** `--cor-principal-1` → "Cor principal 1" — o inverso de `tokenDoNome`, para reidratar o campo de nome. */
function humanoDoToken(nomeReal: string): string {
	const limpo = nomeReal.replace(/^--/, "").replace(/-/g, " ").trim();
	if (!limpo) return nomeReal;
	return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

// ============================================================================================
// Cores
// ============================================================================================

const ESCALA_PADRAO = ["#f5f5f7", "#c7c9d6", "#8a8da3", "#52556b", "#26283a"];
const INDICE_BASE = PASSOS_LUMINOSIDADE.indexOf(0);

function desenharSecaoCoresPrincipais(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const nomes = [1, 2, 3, 4, 5].map((n) => `Cor principal ${n}`);
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|cores-principais",
		titulo: "1. Cores principais",
		descricao:
			"As cores que carregam a identidade do projeto. Digite um hex e a escala de 2 tons mais claros e 2 mais escuros é calculada sozinha — clique num tom para ajustar saturação e luminosidade dele.",
		resumo: `${nomes.length} variáveis`,
		abertoPorPadrao: true,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-principais" });
		for (const nome of nomes) {
			desenharCorPrincipal(grade, nome, campoDoSlot(porToken, nome), porToken, acoes);
		}
	});
}

/**
 * O cartão de cor com escala: a cor que ela digita fica sempre no tom do meio, e os outros 4 são
 * calculados a partir dele (mesmo matiz/saturação, luminosidade em passos — ver `escala-cor.ts`).
 *
 * Cada tom lateral pode ganhar um ajuste fino de saturação/luminosidade (clicar nele abre o popover
 * de sliders); o ajuste é salvo como dois tokens à parte (`-tomN-sat`/`-tomN-lum`), sob o nome ATUAL
 * do token principal — se ela renomear depois, os tokens de ajuste ficam órfãos (ligados ao nome
 * antigo); é uma limitação aceita: renomear é para o caso raro, e ela confirmou que só nomeia uma
 * vez por variável na prática.
 */
function desenharCorPrincipal(
	pai: HTMLElement,
	nomeInicial: string,
	campo: Campo | null,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const cartao = pai.createDiv({ cls: "ve-ds-cartao" });

	const { cabecalho } = desenharCabecalhoNomeavel(cartao, nomeInicial, campo, acoes);
	cabecalho.addClass("ve-ds-cartao-cabecalho");

	const valorBase = campo?.valor ?? ESCALA_PADRAO[INDICE_BASE];
	const blocoOficial = cartao.createDiv({ cls: "ve-ds-bloco-oficial" });
	blocoOficial.style.background = valorBase;

	const escala = cartao.createDiv({ cls: "ve-ds-escala" });

	const tokenAtual = campo?.nomeReal ?? tokenDoNome(nomeInicial);
	const ajusteDoTom = (indice: number): AjusteTom => ({
		sat: percentualParaNumero(porToken.get(`${tokenAtual}-tom${indice}-sat`)?.valor),
		lum: percentualParaNumero(porToken.get(`${tokenAtual}-tom${indice}-lum`)?.valor),
	});

	const hslBase = hexParaHsl(valorBase);

	PASSOS_LUMINOSIDADE.forEach((passo, indice) => {
		if (indice === INDICE_BASE) {
			// O tom do meio É a cor base — não recalcula, não abre ajuste. Continua clicável: um
			// seletor de cor nativo, invisível por cima, mesmo truque do `.ve-ds-swatch`.
			const tonBase = escala.createDiv({ cls: "ve-ds-tom is-base" });
			tonBase.style.background = valorBase;

			const seletorBase = tonBase.createEl("input", {
				cls: "ve-ds-tom-seletor",
				attr: { type: "color", value: valorParaSeletor(valorBase) },
			});
			seletorBase.addEventListener("input", () => {
				tonBase.style.background = seletorBase.value;
				blocoOficial.style.background = seletorBase.value;
				campoEntrada.value = seletorBase.value;
			});
			seletorBase.addEventListener("change", () => gravarBase(seletorBase.value));
			return;
		}

		const ajuste = ajusteDoTom(indice);
		const hex = hslBase ? tomCalculado(hslBase, passo, ajuste) : ESCALA_PADRAO[indice];

		const tonEl = escala.createDiv({ cls: "ve-ds-tom" });
		tonEl.style.background = hex;
		tonEl.setAttr("role", "button");
		tonEl.setAttr("aria-label", `Ajustar tom ${indice < INDICE_BASE ? "mais escuro" : "mais claro"}`);

		tonEl.addEventListener("click", () => {
			if (!hslBase) return;
			acoes.abrirAjusteTom(
				tonEl,
				`tom ${indice < INDICE_BASE ? "escuro" : "claro"}`,
				ajuste,
				hex,
				(novo) => {
					const hexNovo = tomCalculado(hslBase, passo, novo);
					tonEl.style.background = hexNovo;
					return hexNovo;
				},
				(novo) => gravarAjuste(indice, novo)
			);
		});
	});

	const linhaValor = cartao.createDiv({ cls: "ve-ds-linha-valor" });
	const campoEntrada = linhaValor.createEl("input", {
		cls: "ve-ds-entrada-hex",
		attr: { type: "text", spellcheck: "false", value: campo?.valor ?? "", placeholder: campo ? "" : "— vazio —" },
	});

	const confirmarTexto = () => {
		const valor = campoEntrada.value.trim();
		if (!valor) return;
		blocoOficial.style.background = valor;
		gravarBase(valor);
	};
	campoEntrada.addEventListener("blur", confirmarTexto);
	campoEntrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") campoEntrada.blur();
	});

	function gravarBase(valor: string): void {
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(tokenAtual, valor);
	}

	function gravarAjuste(indice: number, ajuste: AjusteTom): void {
		const tokenSat = `${tokenAtual}-tom${indice}-sat`;
		const tokenLum = `${tokenAtual}-tom${indice}-lum`;
		const campoSat = porToken.get(tokenSat) ?? null;
		const campoLum = porToken.get(tokenLum) ?? null;

		if (campoSat) acoes.aplicarToken(campoSat.chave, numeroParaPercentual(ajuste.sat));
		else acoes.criarToken(tokenSat, numeroParaPercentual(ajuste.sat));

		if (campoLum) acoes.aplicarToken(campoLum.chave, numeroParaPercentual(ajuste.lum));
		else acoes.criarToken(tokenLum, numeroParaPercentual(ajuste.lum));
	}
}

function desenharSecaoCoresClaras(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	desenharSecaoCorSimples(raiz, {
		chave: "design-system|cores-claras",
		titulo: "2. Cores claras",
		descricao: "Tons claros soltos — você escolhe livremente, sem cálculo automático.",
		prefixo: "Cor clara",
		quantidade: 4,
	}, porToken, acoes);
}

function desenharSecaoCoresEscuras(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	desenharSecaoCorSimples(raiz, {
		chave: "design-system|cores-escuras",
		titulo: "3. Cores escuras",
		descricao: "Tons escuros soltos — você escolhe livremente, sem cálculo automático.",
		prefixo: "Cor escura",
		quantidade: 4,
	}, porToken, acoes);
}

function desenharSecaoCoresDestaque(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	desenharSecaoCorSimples(raiz, {
		chave: "design-system|cores-destaque",
		titulo: "4. Cores destaque",
		descricao: "Cores de reforço — erro, sucesso, aviso, ou qualquer papel que você nomear.",
		prefixo: "Cor destaque",
		quantidade: 5,
	}, porToken, acoes);
}

interface ConfigSecaoCor {
	chave: string;
	titulo: string;
	descricao: string;
	prefixo: string;
	quantidade: number;
}

function desenharSecaoCorSimples(raiz: HTMLElement, config: ConfigSecaoCor, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const nomes = Array.from({ length: config.quantidade }, (_, i) => `${config.prefixo} ${i + 1}`);
	const acordeao = criarAcordeao(raiz, {
		chave: config.chave,
		titulo: config.titulo,
		descricao: config.descricao,
		resumo: `${nomes.length} variáveis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const nome of nomes) {
			desenharCartaoCorSimples(grade, nome, campoDoSlot(porToken, nome), acoes);
		}
	});
}

/** Cartão de cor simples: retângulo + seletor de cor + campo hex, com nome editável no cabeçalho. */
function desenharCartaoCorSimples(pai: HTMLElement, nomeInicial: string, campo: Campo | null, acoes: AcoesDesignSystem): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	desenharCabecalhoNomeavel(cartao, nomeInicial, campo, acoes);

	const tokenAtual = campo?.nomeReal ?? tokenDoNome(nomeInicial);

	const bloco = cartao.createDiv({ cls: "ve-ds-bloco-cor" });
	bloco.style.background = campo?.valor ?? "var(--background-primary)";

	const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	const seletor = criarSeletorCor(linha, campo?.valor);
	const entradaHex = linha.createEl("input", {
		cls: "ve-ds-entrada-hex-inline",
		attr: { type: "text", spellcheck: "false", value: campo?.valor ?? "", placeholder: campo ? "" : "— vazio —" },
	});

	seletor.addEventListener("input", () => {
		entradaHex.value = seletor.value;
		bloco.style.background = seletor.value;
		seletor.parentElement!.style.background = seletor.value;
	});
	seletor.addEventListener("change", () => gravar(seletor.value));

	const confirmarTexto = () => {
		const valor = entradaHex.value.trim();
		if (!valor) return;
		bloco.style.background = valor;
		gravar(valor);
	};
	entradaHex.addEventListener("blur", confirmarTexto);
	entradaHex.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entradaHex.blur();
	});

	function gravar(valor: string): void {
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(tokenAtual, valor);
	}
}

// ============================================================================================
// Formato (raio)
// ============================================================================================

/**
 * 4 raios com slider livre + 1 pílula fixa (999px, sem slider — não faz sentido escolher "quase
 * pílula"). Pedido dela: *"quatro opções de arredondamento, e a última em formato de pílula"*.
 */
function desenharSecaoFormato(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const nomes = [1, 2, 3, 4].map((n) => `Raio ${n}`);
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|formato",
		titulo: "5. Formato",
		descricao: "O quanto uma borda arredonda. Quatro raios livres e uma pílula pronta.",
		resumo: `${nomes.length + 1} variáveis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const nome of nomes) {
			desenharCartaoRaio(grade, nome, campoDoSlot(porToken, nome), acoes);
		}
		desenharCartaoPilula(grade, "Pílula", campoDoSlot(porToken, "Pílula"), acoes);
	});
}

function desenharCartaoRaio(pai: HTMLElement, nomeInicial: string, campo: Campo | null, acoes: AcoesDesignSystem): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	desenharCabecalhoNomeavel(cartao, nomeInicial, campo, acoes);

	const tokenAtual = campo?.nomeReal ?? tokenDoNome(nomeInicial);

	const preview = cartao.createDiv({ cls: "ve-ds-preview-medida" });
	preview.style.borderRadius = campo?.valor ?? "0px";

	const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	desenharSliderMedida(linha, tokenAtual, campo, acoes, { min: 0, max: 48 }, (valor) => {
		preview.style.borderRadius = valor;
	});
}

/**
 * A pílula é sempre 999px — não tem slider, só o nome é editável. Sem valor a escolher, o token só
 * nasce quando ela CLICA no preview (nunca sozinho durante o desenho — gravar automaticamente aqui
 * dispararia `criarToken` → redesenho → desenho de novo a cada abertura da seção, um loop).
 */
function desenharCartaoPilula(pai: HTMLElement, nomeInicial: string, campo: Campo | null, acoes: AcoesDesignSystem): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	desenharCabecalhoNomeavel(cartao, nomeInicial, campo, acoes);

	const tokenAtual = campo?.nomeReal ?? tokenDoNome(nomeInicial);

	const preview = cartao.createDiv({ cls: "ve-ds-preview-medida" });
	preview.style.borderRadius = "999px";
	if (!campo) {
		preview.addClass("is-reserva-clicavel");
		preview.setText("clique para criar");
		preview.setAttr("role", "button");
		preview.setAttr("aria-label", "Criar a variável de pílula");
		preview.addEventListener("click", () => acoes.criarToken(tokenAtual, "999px"));
	}
}

/**
 * Slider + campo numérico para uma medida em px — mesmas classes `.ve-slider`/`.ve-entrada-numero`
 * que o resto do plugin usa em `controles.ts`.
 */
function desenharSliderMedida(
	pai: HTMLElement,
	tokenBase: string,
	campo: Campo | null,
	acoes: AcoesDesignSystem,
	opcoes: { min: number; max: number; passo?: number },
	aoMudar: (valor: string) => void
): void {
	const numeroAtual = parseFloat(campo?.valor ?? "0") || 0;

	const caixa = pai.createDiv({ cls: "ve-controle ve-controle-medida" });
	const slider = caixa.createEl("input", {
		cls: "ve-slider",
		attr: {
			type: "range",
			min: String(opcoes.min),
			max: String(opcoes.max),
			step: String(opcoes.passo ?? 1),
			value: String(numeroAtual),
		},
	});
	const numero = caixa.createEl("input", {
		cls: "ve-entrada ve-entrada-numero",
		attr: { type: "number", step: String(opcoes.passo ?? 1), value: String(numeroAtual) },
	});
	caixa.createSpan({ cls: "ve-unidade", text: "px" });

	const gravar = (valor: string) => {
		aoMudar(`${valor}px`);
		if (campo) acoes.aplicarToken(campo.chave, `${valor}px`);
		else acoes.criarToken(tokenBase, `${valor}px`);
	};

	slider.addEventListener("input", () => {
		numero.value = slider.value;
		aoMudar(`${slider.value}px`);
	});
	slider.addEventListener("change", () => gravar(slider.value));

	const confirmarNumero = () => {
		const bruto = numero.value.trim();
		if (bruto === "") return;
		slider.value = bruto;
		gravar(bruto);
	};
	numero.addEventListener("blur", confirmarNumero);
	numero.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") {
			evento.preventDefault();
			numero.blur();
		}
	});
}

// ============================================================================================
// Sombra
// ============================================================================================

const PREDEFINICOES_SOMBRA = [
	{ cor: "#1a1a2e", x: 0, y: 2, blur: 8, opacidade: 12 },
	{ cor: "#1a1a2e", x: 0, y: 4, blur: 12, opacidade: 18 },
	{ cor: "#1a1a2e", x: 0, y: 8, blur: 24, opacidade: 24 },
];

function desenharSecaoSombra(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const nomes = [1, 2, 3].map((n) => `Sombra ${n}`);
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|sombra",
		titulo: "6. Sombra",
		descricao: "Cor, deslocamento, desfoque e opacidade de cada sombra, com uma prévia ao lado.",
		resumo: `${nomes.length} variáveis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-sombra" });
		nomes.forEach((nome, indice) => {
			desenharCartaoSombra(grade, nome, PREDEFINICOES_SOMBRA[indice], porToken, acoes);
		});
	});
}

function desenharCartaoSombra(
	pai: HTMLElement,
	nomeInicial: string,
	predefinicao: { cor: string; x: number; y: number; blur: number; opacidade: number },
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	// Sombra nunca grava um token "puro" (`--sombra-1`) — só os cinco sufixos (`-cor`, `-x`…), então
	// `campoDoSlot` (que busca pelo nome NU) não serve aqui. O nome base é derivado do próprio token
	// de cor já lido (`campoCor.nomeReal` menos o sufixo `-cor`) quando ele existe; sem cor ainda,
	// cai no slug do nome provisório, igual ao resto do catálogo.
	const tokenBaseInicial = tokenDoNome(nomeInicial);
	const sub = (sufixo: string) => porToken.get(`${tokenBaseInicial}-${sufixo}`) ?? null;
	const campoCor = sub("cor");
	const tokenBase = () => (campoCor ? campoCor.nomeReal.replace(/-cor$/, "") : tokenBaseInicial);
	const campoX = sub("x");
	const campoY = sub("y");
	const campoBlur = sub("blur");
	const campoOpacidade = sub("opacidade");
	const preenchido = !!campoCor;
	const p = predefinicao;

	const cartao = pai.createDiv({ cls: "ve-ds-amostra-sombra" });
	desenharCabecalhoNomeavel(cartao, nomeInicial, campoCor, acoes, (novoToken) => {
		// Um nome comanda cinco tokens aqui — os cinco são renomeados NUMA PASSADA SÓ
		// (`renomearToken` aceita a lista inteira), senão o redesenho no meio do caminho invalidaria
		// os `Campo` já capturados para os sufixos seguintes.
		const sufixos: Array<[Campo | null, string]> = [
			[campoCor, "cor"],
			[campoX, "x"],
			[campoY, "y"],
			[campoBlur, "blur"],
			[campoOpacidade, "opacidade"],
		];
		const pares = sufixos
			.filter((par): par is [Campo, string] => par[0] !== null)
			.map(([campoSufixo, sufixo]) => ({
				chave: campoSufixo.chave,
				nomeAntigo: campoSufixo.nomeReal,
				nomeNovo: `${novoToken}-${sufixo}`,
			}));
		return acoes.renomearToken(pares);
	});

	const preview = cartao.createDiv({ cls: "ve-ds-preview-sombra" });

	if (!preenchido) {
		// Desativada: uma caixa com "×", sem campos visíveis — distingue "ainda não configurei" de
		// "configurei com desfoque 0". Ativar preenche os cinco tokens de uma vez com a predefinição.
		cartao.addClass("is-desativada");
		const ativador = cartao.createDiv({ cls: "ve-ds-sombra-ativador", attr: { role: "button" } });
		ativador.createSpan({ cls: "ve-ds-sombra-ativador-x", text: "×" });
		ativador.createSpan({ text: "desativada — clique para ativar" });
		ativador.addEventListener("click", () => {
			const base = tokenBase();
			acoes.criarToken(`${base}-cor`, p.cor);
			acoes.criarToken(`${base}-x`, `${p.x}px`);
			acoes.criarToken(`${base}-y`, `${p.y}px`);
			acoes.criarToken(`${base}-blur`, `${p.blur}px`);
			acoes.criarToken(`${base}-opacidade`, `${p.opacidade}%`);
		});
		preview.style.boxShadow = "none";
		return;
	}

	// Desativar de novo: zera a opacidade — sem isto, uma vez preenchida a sombra nunca mais podia
	// sumir. Como o plugin não tem operação de "apagar token", zerar a opacidade é o que aproxima
	// "desativada" sem remover linhas do arquivo: o preview mostra a sombra invisível, e o campo
	// atualiza para "0" na hora (senão pareceria que o clique não fez nada).
	const desativar = () => {
		entradaOpacidade.value = "0";
		if (campoOpacidade) acoes.aplicarToken(campoOpacidade.chave, "0%");
		else acoes.criarToken(`${tokenBase()}-opacidade`, "0%");
		atualizarPreview();
	};

	const atualizarPreview = () => {
		const cor = entradaCor?.value ?? p.cor;
		const x = entradaX?.value ?? String(p.x);
		const y = entradaY?.value ?? String(p.y);
		const blur = entradaBlur?.value ?? String(p.blur);
		const opacidade = entradaOpacidade?.value ?? String(p.opacidade);
		preview.style.boxShadow = `${x}px ${y}px ${blur}px color-mix(in srgb, ${cor} ${opacidade}%, transparent)`;
	};

	const linha = cartao.createDiv({ cls: "ve-ds-camada-sombra" });
	const caixaCor = linha.createDiv({ cls: "ve-ds-sombra-swatch" });
	caixaCor.style.background = campoCor?.valor ?? p.cor;
	const entradaCor = caixaCor.createEl("input", {
		cls: "ve-ds-sombra-cor",
		attr: { type: "color", value: valorParaSeletor(campoCor?.valor ?? p.cor) },
	});
	const entradaX = linha.createEl("input", {
		cls: "ve-ds-sombra-mini",
		attr: { type: "text", value: campoX?.valor?.replace(/px$/, "") ?? String(p.x), "aria-label": "Deslocamento X" },
	});
	const entradaY = linha.createEl("input", {
		cls: "ve-ds-sombra-mini",
		attr: { type: "text", value: campoY?.valor?.replace(/px$/, "") ?? String(p.y), "aria-label": "Deslocamento Y" },
	});
	const entradaBlur = linha.createEl("input", {
		cls: "ve-ds-sombra-mini",
		attr: { type: "text", value: campoBlur?.valor?.replace(/px$/, "") ?? String(p.blur), "aria-label": "Desfoque" },
	});
	const entradaOpacidade = linha.createEl("input", {
		cls: "ve-ds-sombra-mini",
		attr: {
			type: "text",
			value: campoOpacidade?.valor?.replace(/%$/, "") ?? String(p.opacidade),
			"aria-label": "Opacidade",
		},
	});

	entradaCor.addEventListener("input", () => {
		caixaCor.style.background = entradaCor.value;
		atualizarPreview();
	});
	entradaCor.addEventListener("change", () => {
		gravar(campoCor, `${tokenBase()}-cor`, entradaCor.value);
		atualizarPreview();
	});
	const ligarCampoMedida = (entrada: HTMLInputElement, campo: Campo | null, sufixo: string, unidade: string) => {
		const confirmar = () => {
			const numero = entrada.value.trim();
			if (!numero) return;
			gravar(campo, `${tokenBase()}-${sufixo}`, `${numero}${unidade}`);
			atualizarPreview();
		};
		entrada.addEventListener("blur", confirmar);
		entrada.addEventListener("keydown", (evento) => {
			if (evento.key === "Enter") entrada.blur();
		});
	};
	ligarCampoMedida(entradaX, campoX, "x", "px");
	ligarCampoMedida(entradaY, campoY, "y", "px");
	ligarCampoMedida(entradaBlur, campoBlur, "blur", "px");
	ligarCampoMedida(entradaOpacidade, campoOpacidade, "opacidade", "%");

	const botaoDesativar = cartao.createEl("button", {
		cls: "ve-ds-sombra-desativar",
		attr: { type: "button" },
		text: "Desativar",
	});
	botaoDesativar.addEventListener("click", desativar);

	function gravar(campoExistente: Campo | null, tokenBase: string, valor: string): void {
		if (campoExistente) acoes.aplicarToken(campoExistente.chave, valor);
		else acoes.criarToken(tokenBase, valor);
	}

	atualizarPreview();
}

// ============================================================================================
// Tipografia — decomposta em 5 catálogos soltos (família, tamanho, peso, letras, entrelinhas)
// ============================================================================================

const FONTES_GOOGLE = [
	"Inter", "Inter Tight", "Sono", "DM Sans", "Roboto Mono", "Zalando Sans", "Manrope", "Nunito Sans",
	"Onest", "Fragment Mono", "Red Hat Mono", "Figtree", "Parkinsans", "Google Sans", "National Park",
	"Quicksand", "Fredoka", "SN Pro",
];

const PESOS_FONTE = [
	{ valor: "300", rotulo: "Leve · 300" },
	{ valor: "400", rotulo: "Normal · 400" },
	{ valor: "500", rotulo: "Médio · 500" },
	{ valor: "600", rotulo: "Semi-negrito · 600" },
	{ valor: "700", rotulo: "Negrito · 700" },
	{ valor: "800", rotulo: "Extra-negrito · 800" },
];

function desenharSecaoTipografia(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	desenharSecaoEstiloDeLetra(raiz, porToken, acoes);
	desenharSecaoTamanhoDeLetra(raiz, porToken, acoes);
	desenharSecaoPeso(raiz, porToken, acoes);
	desenharSecaoEspacamentoEntreLetras(raiz, porToken, acoes);
	desenharSecaoEntrelinhas(raiz, porToken, acoes);
}

function desenharSecaoEstiloDeLetra(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const nomes = [1, 2, 3].map((n) => `Estilo ${n}`);
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|estilo-letra",
		titulo: "7. Estilo da letra",
		descricao: "A família tipográfica — busque entre as fontes do Google ou escreva outra.",
		resumo: `${nomes.length} variáveis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const nome of nomes) {
			desenharCartaoFonte(grade, nome, campoDoSlot(porToken, nome), acoes);
		}
	});
}

function desenharCartaoFonte(pai: HTMLElement, nomeInicial: string, campo: Campo | null, acoes: AcoesDesignSystem): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	desenharCabecalhoNomeavel(cartao, nomeInicial, campo, acoes);

	const tokenAtual = campo?.nomeReal ?? tokenDoNome(nomeInicial);

	const amostra = cartao.createDiv({ cls: "ve-ds-amostra-tipo-texto", text: "Aa" });
	amostra.style.fontFamily = campo?.valor ?? "inherit";

	desenharCampoFonte(cartao, tokenAtual, campo, acoes, (valor) => {
		amostra.style.fontFamily = valor;
	});
}

/**
 * O campo de família: um botão que abre a busca de fontes (`ModalEscolherFonte`) — cada nome da
 * lista escrito na própria tipografia. "Outra…" continua como campo de texto à parte.
 */
function desenharCampoFonte(
	pai: HTMLElement,
	tokenBase: string,
	campo: Campo | null,
	acoes: AcoesDesignSystem,
	aoMudar: (valor: string) => void
): void {
	const campoEl = pai.createDiv({ cls: "ve-ds-campo-valor" });

	const valorAtual = campo?.valor ?? "";
	const conhecida = FONTES_GOOGLE.includes(valorAtual);

	const botaoFonte = campoEl.createEl("button", {
		cls: "ve-ds-botao-fonte",
		attr: { type: "button" },
		text: valorAtual || "Escolher…",
	});
	if (valorAtual) botaoFonte.style.fontFamily = `"${valorAtual}"`;
	botaoFonte.toggleClass("is-oculto", !conhecida && !!valorAtual);

	const entradaOutra = campoEl.createEl("input", {
		cls: "ve-ds-outra-fonte",
		attr: { type: "text", placeholder: "nome da fonte", value: !conhecida ? valorAtual : "" },
	});
	entradaOutra.toggleClass("is-oculto", conhecida || !valorAtual);

	const linkOutra = campoEl.createEl("button", {
		cls: "ve-ds-link-outra-fonte",
		attr: { type: "button" },
		text: conhecida || !valorAtual ? "Outra fonte…" : "Escolher da lista…",
	});

	const gravar = (valor: string) => {
		if (!valor.trim()) return;
		aoMudar(valor);
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(tokenBase, valor);
	};

	const mostrarBotao = (fonte: string) => {
		botaoFonte.setText(fonte);
		botaoFonte.style.fontFamily = `"${fonte}"`;
		botaoFonte.removeClass("is-oculto");
		entradaOutra.addClass("is-oculto");
		linkOutra.setText("Outra fonte…");
	};

	botaoFonte.addEventListener("click", () => {
		acoes.abrirSeletorFonte(FONTES_GOOGLE, (fonte) => {
			mostrarBotao(fonte);
			gravar(fonte);
		});
	});

	linkOutra.addEventListener("click", () => {
		const mostrandoOutra = !entradaOutra.hasClass("is-oculto");
		if (mostrandoOutra) {
			acoes.abrirSeletorFonte(FONTES_GOOGLE, (fonte) => {
				mostrarBotao(fonte);
				gravar(fonte);
			});
			return;
		}
		botaoFonte.addClass("is-oculto");
		entradaOutra.removeClass("is-oculto");
		linkOutra.setText("Escolher da lista…");
		entradaOutra.focus();
	});

	entradaOutra.addEventListener("blur", () => gravar(entradaOutra.value));
	entradaOutra.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entradaOutra.blur();
	});
}

function desenharSecaoTamanhoDeLetra(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const nomes = [1, 2, 3, 4, 5].map((n) => `Tamanho ${n}`);
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|tamanho-letra",
		titulo: "8. Tamanho da letra",
		descricao: "Cinco tamanhos de fonte, em px.",
		resumo: `${nomes.length} variáveis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const nome of nomes) {
			desenharCartaoMedidaTipografica(grade, nome, campoDoSlot(porToken, nome), acoes, {
				min: 8,
				max: 64,
				unidade: "px",
				aplicarPreview: (amostra, valor) => (amostra.style.fontSize = valor),
			});
		}
	});
}

function desenharSecaoPeso(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const nomes = [1, 2, 3, 4, 5].map((n) => `Peso ${n}`);
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|peso",
		titulo: "9. Peso",
		descricao: "Cinco pesos de fonte.",
		resumo: `${nomes.length} variáveis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const nome of nomes) {
			desenharCartaoPeso(grade, nome, campoDoSlot(porToken, nome), acoes);
		}
	});
}

function desenharCartaoPeso(pai: HTMLElement, nomeInicial: string, campo: Campo | null, acoes: AcoesDesignSystem): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	desenharCabecalhoNomeavel(cartao, nomeInicial, campo, acoes);

	const tokenAtual = campo?.nomeReal ?? tokenDoNome(nomeInicial);

	const amostra = cartao.createDiv({ cls: "ve-ds-amostra-tipo-texto", text: "Aa" });
	amostra.style.fontWeight = campo?.valor ?? "400";

	const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	const valorAtual = campo?.valor ?? "400";
	const select = linha.createEl("select", { cls: "ve-ds-select-sombra" });
	for (const peso of PESOS_FONTE) {
		const opcao = select.createEl("option", { text: peso.rotulo, value: peso.valor });
		if (peso.valor === valorAtual) opcao.selected = true;
	}
	select.addEventListener("change", () => {
		amostra.style.fontWeight = select.value;
		if (campo) acoes.aplicarToken(campo.chave, select.value);
		else acoes.criarToken(tokenAtual, select.value);
	});
}

function desenharSecaoEspacamentoEntreLetras(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const nomes = [1, 2, 3].map((n) => `Espaçamento ${n}`);
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|espacamento-letras",
		titulo: "10. Espaçamento entre letras",
		descricao: "Três opções de letter-spacing, em px.",
		resumo: `${nomes.length} variáveis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const nome of nomes) {
			desenharCartaoMedidaTipografica(grade, nome, campoDoSlot(porToken, nome), acoes, {
				min: -2,
				max: 8,
				passo: 0.5,
				unidade: "px",
				aplicarPreview: (amostra, valor) => (amostra.style.letterSpacing = valor),
			});
		}
	});
}

function desenharSecaoEntrelinhas(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const nomes = [1, 2, 3].map((n) => `Entrelinhas ${n}`);
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|entrelinhas",
		titulo: "11. Entrelinhas",
		descricao: "Três opções de altura de linha — um multiplicador, sem unidade.",
		resumo: `${nomes.length} variáveis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const nome of nomes) {
			desenharCartaoMedidaTipografica(grade, nome, campoDoSlot(porToken, nome), acoes, {
				min: 0.8,
				max: 3,
				passo: 0.05,
				unidade: "",
				aplicarPreview: (amostra, valor) => (amostra.style.lineHeight = valor || "normal"),
			});
		}
	});
}

/** Um cartão com amostra "Aa" e um campo de texto que confirma no blur/Enter — usado por tamanho, letras e entrelinhas. */
function desenharCartaoMedidaTipografica(
	pai: HTMLElement,
	nomeInicial: string,
	campo: Campo | null,
	acoes: AcoesDesignSystem,
	opcoes: { min: number; max: number; passo?: number; unidade: string; aplicarPreview: (amostra: HTMLElement, valor: string) => void }
): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	desenharCabecalhoNomeavel(cartao, nomeInicial, campo, acoes);

	const tokenAtual = campo?.nomeReal ?? tokenDoNome(nomeInicial);

	const amostra = cartao.createDiv({ cls: "ve-ds-amostra-tipo-texto", text: "Aa" });
	opcoes.aplicarPreview(amostra, campo?.valor ?? "");

	const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	const entrada = linha.createEl("input", {
		cls: "ve-ds-entrada-hex-inline",
		attr: { type: "text", spellcheck: "false", value: campo?.valor?.replace(/px$/, "") ?? "" },
	});

	// "input" atualiza a prévia a cada tecla; "blur"/Enter gravam — mesma disciplina do resto do
	// catálogo (um bug corrigido numa sessão anterior era exatamente essa prévia não reagir ao vivo).
	entrada.addEventListener("input", () => {
		const numero = entrada.value.trim();
		if (numero) opcoes.aplicarPreview(amostra, `${numero}${opcoes.unidade}`);
	});

	const confirmar = () => {
		const numero = entrada.value.trim();
		if (!numero) return;
		const valorGravado = `${numero}${opcoes.unidade}`;
		if (campo) acoes.aplicarToken(campo.chave, valorGravado);
		else acoes.criarToken(tokenAtual, valorGravado);
	};
	entrada.addEventListener("blur", confirmar);
	entrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entrada.blur();
	});
}
