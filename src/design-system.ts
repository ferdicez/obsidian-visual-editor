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
 * A aba Design System: um catálogo curado de papéis de token, em vez da lista bruta que Tokens
 * mostra. Onde Tokens exibe o que o arquivo JÁ tem, esta aba mostra o que um design system
 * PRECISA ter — inclusive os papéis que o arquivo ainda não declarou ("de reserva").
 *
 * Nasceu de um mockup HTML validado fora do Obsidian (ver `plugins/_docs/visual-editor.md`).
 * Primeira seção construída: Cores principais. As demais (Status, Background/Texto/Cards, Botões,
 * Tipografia, Sombra, Espaço/Raio, Alerts) seguem o mesmo padrão depois de validada esta.
 */

export interface AcoesDesignSystem {
	/** Grava um valor num token que JÁ existe no arquivo. */
	aplicarToken: (chave: string, novo: string) => void;
	/**
	 * Declara um token que ainda não existe (papel "de reserva"), e o aplica em seguida.
	 * Quando falha (sem `:root`/`@theme` no arquivo), mostra o motivo em vez de falhar em silêncio.
	 */
	criarToken: (nome: string, valorInicial: string) => void;
	/** Abre a janelinha de ajuste fino (saturação/luminosidade) de um tom da escala. */
	abrirAjusteTom: (
		ancora: HTMLElement,
		rotulo: string,
		valorInicial: AjusteTom,
		aoMudar: (valor: AjusteTom) => void,
		aoSoltar: (valor: AjusteTom) => void
	) => void;
}

/** Um papel de cor dentro de "Cores principais": nome fixo do token + rótulo mostrado na tela. */
interface PapelPrincipal {
	tokenBase: string; // "--principal-1"
	rotulo: string; // "Principal 1"
}

const PAPEIS_PRINCIPAIS: PapelPrincipal[] = [
	{ tokenBase: "--principal-1", rotulo: "Principal 1" },
	{ tokenBase: "--principal-2", rotulo: "Principal 2" },
	{ tokenBase: "--principal-3", rotulo: "Principal 3" },
	{ tokenBase: "--principal-4", rotulo: "Principal 4" },
	{ tokenBase: "--principal-5", rotulo: "Principal 5" },
];

/**
 * A escala de tons oferecida por padrão quando o papel ainda não tem token no arquivo — antes de
 * ela digitar uma cor, não há base nenhuma para calcular uma escala em cima.
 */
const ESCALA_PADRAO = ["#f5f5f7", "#c7c9d6", "#8a8da3", "#52556b", "#26283a"];

/** Índice do tom-base dentro de `PASSOS_LUMINOSIDADE` — os outros 4 são calculados a partir dele. */
const INDICE_BASE = PASSOS_LUMINOSIDADE.indexOf(0);

export function desenharDesignSystem(pai: HTMLElement, campos: Campo[], formato: Formato, acoes: AcoesDesignSystem): void {
	const raiz = pai.createDiv({ cls: "ve-ds" });

	if (formato !== "css") {
		raiz.createDiv({
			cls: "ve-ds-aviso",
			text: "O catálogo de Design System só está disponível para arquivos CSS — é onde tokens (--nome: valor) fazem sentido.",
		});
		return;
	}

	const porToken = new Map(campos.filter((c) => c.papel !== "propriedade").map((c) => [c.nomeReal, c]));

	desenharSecaoCoresPrincipais(raiz, porToken, acoes);
	desenharSecaoStatus(raiz, porToken, acoes);
	desenharSecaoGruposFuncionais(raiz, porToken, acoes);
	desenharSecaoBotoes(raiz, porToken, acoes);
	desenharSecaoTipografia(raiz, porToken, acoes);
	desenharSecaoSombra(raiz, porToken, acoes);
	desenharSecaoEspacoRaio(raiz, porToken, acoes);
	desenharSecaoAlerts(raiz, porToken, acoes);
}

/** Um papel simples: nome fixo do token + rótulo. Reaproveitado por Status, Background, Texto e Alerts. */
interface Papel {
	tokenBase: string;
	rotulo: string;
}

/**
 * Cartão de cor simples: retângulo + seletor de cor nativo + campo hex. É o padrão de Status,
 * Background e Texto — três seções que só diferem no rótulo e no valor inicial de reserva.
 *
 * Reaproveita o mesmo `gravar`/reserva de `desenharCorPrincipal`, mas sem a escala de tons: aqui a
 * cor não tem "oficial entre variações", é um papel único (ex.: "Status 1" não tem tom claro/escuro).
 */
function desenharCartaoCorSimples(pai: HTMLElement, papel: Papel, campo: Campo | null, acoes: AcoesDesignSystem): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	if (!campo) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!campo) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const bloco = cartao.createDiv({ cls: "ve-ds-bloco-cor" });
	bloco.style.background = campo?.valor ?? "var(--background-primary)";

	const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	const seletor = linha.createEl("input", {
		attr: { type: "color", value: valorParaSeletor(campo?.valor) },
	});
	const entradaHex = linha.createEl("input", {
		cls: "ve-ds-entrada-hex-inline",
		attr: { type: "text", spellcheck: "false", value: campo?.valor ?? "", placeholder: campo ? "" : "— vazio —" },
	});

	// "input" só acompanha o arraste visualmente — gravar a cada pixel destrói e recria este próprio
	// <input> a cada redesenho, cortando o arraste pela raiz. "change" dispara só ao soltar/fechar.
	seletor.addEventListener("input", () => {
		entradaHex.value = seletor.value;
		bloco.style.background = seletor.value;
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
		cartao.removeClass("is-reserva");
		cabecalho.querySelector(".ve-ds-badge-reserva")?.remove();
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(papel.tokenBase, valor);
	}
}

/** `<input type="color">` recusa valores não-hex (nomes CSS, vazio) — cai num cinza neutro nesses casos. */
function valorParaSeletor(valor: string | undefined): string {
	if (valor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(valor.trim())) return valor.trim();
	return "#8a8da3";
}

function desenharSecaoCoresPrincipais(
	raiz: HTMLElement,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|cores-principais",
		titulo: "1. Cores principais",
		descricao: "As cinco cores que carregam a identidade do projeto. Digite um hex e a escala de 2 tons mais claros e 2 mais escuros é calculada sozinha — clique num tom para ajustar saturação e luminosidade dele.",
		resumo: `${PAPEIS_PRINCIPAIS.length} papéis`,
		abertoPorPadrao: true,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-principais" });

		for (const papel of PAPEIS_PRINCIPAIS) {
			desenharCorPrincipal(grade, papel, porToken.get(papel.tokenBase) ?? null, porToken, acoes);
		}
	});
}

/**
 * O cartão de "Cores principais": a cor que ela digita fica sempre no tom do meio, e os outros 4 são
 * calculados a partir dele (mesmo matiz/saturação, luminosidade em passos — ver `escala-cor.ts`).
 *
 * Cada tom lateral pode ganhar um ajuste fino de saturação/luminosidade (clicar nele abre o popover
 * de sliders); o ajuste é salvo como dois tokens à parte (`-tomN-sat`/`-tomN-lum`), relativos ao tom
 * CALCULADO — não ao hex final. Assim reabrir e ajustar de novo não acumula erro, e trocar a cor
 * base recalcula a escala inteira sem perder os ajustes relativos que ela já fez.
 */
function desenharCorPrincipal(
	pai: HTMLElement,
	papel: PapelPrincipal,
	campo: Campo | null,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const cartao = pai.createDiv({ cls: "ve-ds-cartao" });
	if (!campo) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-cartao-cabecalho" });
	cabecalho.createSpan({ cls: "ve-ds-cartao-rotulo", text: papel.rotulo });
	if (!campo) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const valorBase = campo?.valor ?? ESCALA_PADRAO[INDICE_BASE];
	const blocoOficial = cartao.createDiv({ cls: "ve-ds-bloco-oficial" });
	blocoOficial.style.background = valorBase;

	const escala = cartao.createDiv({ cls: "ve-ds-escala" });

	const ajusteDoTom = (indice: number): AjusteTom => ({
		sat: percentualParaNumero(porToken.get(`${papel.tokenBase}-tom${indice}-sat`)?.valor),
		lum: percentualParaNumero(porToken.get(`${papel.tokenBase}-tom${indice}-lum`)?.valor),
	});

	const hslBase = hexParaHsl(valorBase);

	PASSOS_LUMINOSIDADE.forEach((passo, indice) => {
		if (indice === INDICE_BASE) {
			// O tom do meio É a cor base — não recalcula, não abre ajuste (não há "tom calculado" a
			// ajustar quando o tom É o valor que ela digitou).
			const tonBase = escala.createDiv({ cls: "ve-ds-tom is-base" });
			tonBase.style.background = valorBase;
			tonBase.setAttr("aria-label", `${papel.rotulo}: cor base`);
			return;
		}

		const ajuste = ajusteDoTom(indice);
		const hex = hslBase ? tomCalculado(hslBase, passo, ajuste) : ESCALA_PADRAO[indice];

		const tonEl = escala.createDiv({ cls: "ve-ds-tom" });
		tonEl.style.background = hex;
		tonEl.setAttr("role", "button");
		tonEl.setAttr(
			"aria-label",
			`Ajustar ${indice < INDICE_BASE ? "tom mais escuro" : "tom mais claro"} de ${papel.rotulo}`
		);

		tonEl.addEventListener("click", () => {
			if (!hslBase) return; // sem cor base ainda, não há o que ajustar
			acoes.abrirAjusteTom(
				tonEl,
				`${papel.rotulo} · tom ${indice < INDICE_BASE ? "escuro" : "claro"}`,
				ajuste,
				(novo) => {
					// Só a prévia local: gravar a cada arraste redesenharia a tela e cortaria o slider.
					tonEl.style.background = tomCalculado(hslBase, passo, novo);
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
		cartao.removeClass("is-reserva");
		const badge = cabecalho.querySelector(".ve-ds-badge-reserva");
		if (badge) badge.remove();

		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(papel.tokenBase, valor);
	}

	function gravarAjuste(indice: number, ajuste: AjusteTom): void {
		const tokenSat = `${papel.tokenBase}-tom${indice}-sat`;
		const tokenLum = `${papel.tokenBase}-tom${indice}-lum`;
		const campoSat = porToken.get(tokenSat) ?? null;
		const campoLum = porToken.get(tokenLum) ?? null;

		if (campoSat) acoes.aplicarToken(campoSat.chave, numeroParaPercentual(ajuste.sat));
		else acoes.criarToken(tokenSat, numeroParaPercentual(ajuste.sat));

		if (campoLum) acoes.aplicarToken(campoLum.chave, numeroParaPercentual(ajuste.lum));
		else acoes.criarToken(tokenLum, numeroParaPercentual(ajuste.lum));
	}
}

const PAPEIS_STATUS: Papel[] = [
	{ tokenBase: "--status-iniciar", rotulo: "Status Iniciar" },
	{ tokenBase: "--status-1", rotulo: "Status 1" },
	{ tokenBase: "--status-2", rotulo: "Status 2" },
	{ tokenBase: "--status-3", rotulo: "Status 3" },
	{ tokenBase: "--status-4", rotulo: "Status 4" },
	{ tokenBase: "--status-concluido", rotulo: "Status Concluído" },
];

function desenharSecaoStatus(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|status",
		titulo: "2. Status",
		descricao: "As seis cores de um fluxo com etapas: do início ao concluído, passando pelas do meio.",
		resumo: `${PAPEIS_STATUS.length} papéis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const papel of PAPEIS_STATUS) {
			desenharCartaoCorSimples(grade, papel, porToken.get(papel.tokenBase) ?? null, acoes);
		}
	});
}

const PAPEIS_BACKGROUND: Papel[] = [1, 2, 3, 4, 5].map((n) => ({ tokenBase: `--bg-${n}`, rotulo: `Background ${n}` }));
const PAPEIS_TEXTO: Papel[] = [1, 2, 3, 4, 5].map((n) => ({ tokenBase: `--texto-cor-${n}`, rotulo: `Texto ${n}` }));

interface PapelCard {
	tokenBase: string; // "--card-1"
	rotulo: string;
}

const PAPEIS_CARD: PapelCard[] = [
	{ tokenBase: "--card-1", rotulo: "Card 1 · cartão padrão" },
	{ tokenBase: "--card-2", rotulo: "Card 2" },
	{ tokenBase: "--card-3", rotulo: "Card 3" },
];

function desenharSecaoGruposFuncionais(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|grupos-funcionais",
		titulo: "3. Background, Texto e Cards",
		descricao: "Cinco opções de fundo, cinco de cor de texto, e três cartões — cada um com a própria borda liga/desliga.",
		resumo: "13 papéis",
	});

	acordeao.sePreenchido((corpo) => {
		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Background" });
		const gradeBg = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const papel of PAPEIS_BACKGROUND) desenharCartaoCorSimples(gradeBg, papel, porToken.get(papel.tokenBase) ?? null, acoes);

		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Texto" });
		const gradeTexto = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const papel of PAPEIS_TEXTO) desenharCartaoCorTexto(gradeTexto, papel, porToken.get(papel.tokenBase) ?? null, acoes);

		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Cards" });
		const gradeCard = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-cards" });
		for (const papel of PAPEIS_CARD) {
			desenharCartaoCard(
				gradeCard,
				papel,
				porToken.get(papel.tokenBase) ?? null,
				porToken.get(`${papel.tokenBase}-borda`) ?? null,
				acoes
			);
		}
	});
}

/** Como o cartão de cor simples, mas o retângulo mostra "Aa" na cor em vez de um bloco sólido. */
function desenharCartaoCorTexto(pai: HTMLElement, papel: Papel, campo: Campo | null, acoes: AcoesDesignSystem): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	if (!campo) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!campo) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const bloco = cartao.createDiv({ cls: "ve-ds-bloco-cor ve-ds-bloco-aa", text: "Aa" });
	bloco.style.color = campo?.valor ?? "var(--text-normal)";

	const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	const seletor = linha.createEl("input", { attr: { type: "color", value: valorParaSeletor(campo?.valor) } });
	const entradaHex = linha.createEl("input", {
		cls: "ve-ds-entrada-hex-inline",
		attr: { type: "text", spellcheck: "false", value: campo?.valor ?? "", placeholder: campo ? "" : "— vazio —" },
	});

	seletor.addEventListener("input", () => {
		entradaHex.value = seletor.value;
		bloco.style.color = seletor.value;
	});
	seletor.addEventListener("change", () => gravar(seletor.value));
	const confirmarTexto = () => {
		const valor = entradaHex.value.trim();
		if (!valor) return;
		bloco.style.color = valor;
		gravar(valor);
	};
	entradaHex.addEventListener("blur", confirmarTexto);
	entradaHex.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entradaHex.blur();
	});

	function gravar(valor: string): void {
		cartao.removeClass("is-reserva");
		cabecalho.querySelector(".ve-ds-badge-reserva")?.remove();
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(papel.tokenBase, valor);
	}
}

/** O interruptor liga/desliga de borda, reaproveitado por Cards e pela forma dos Botões. */
function desenharBordaToggle(
	pai: HTMLElement,
	tokenBorda: string,
	campoBorda: Campo | null,
	acoes: AcoesDesignSystem
): void {
	const ligada = campoBorda?.valor?.trim() === "1";

	const toggle = pai.createDiv({ cls: "ve-ds-borda-toggle" });
	const chave = toggle.createSpan({ cls: "ve-ds-mini-switch" });
	if (ligada) chave.addClass("is-ligado");
	toggle.createSpan({ text: "borda" });

	toggle.setAttr("role", "button");
	toggle.addEventListener("click", () => {
		const novoValor = ligada ? "0" : "1";
		chave.toggleClass("is-ligado", !ligada);
		if (campoBorda) acoes.aplicarToken(campoBorda.chave, novoValor);
		else acoes.criarToken(tokenBorda, novoValor);
	});
}

function desenharCartaoCard(
	pai: HTMLElement,
	papel: PapelCard,
	campo: Campo | null,
	campoBorda: Campo | null,
	acoes: AcoesDesignSystem
): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra-card" });
	if (!campo) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!campo) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	if (campo) {
		cartao.createEl("h4", { text: "Título do card" });
		cartao.createEl("p", { text: `Texto de apoio usando o fundo ${papel.rotulo.split(" ")[0].toLowerCase()}.` });
	}

	const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	const seletor = linha.createEl("input", { attr: { type: "color", value: valorParaSeletor(campo?.valor) } });
	const entradaHex = linha.createEl("input", {
		cls: "ve-ds-entrada-hex-inline",
		attr: { type: "text", spellcheck: "false", value: campo?.valor ?? "", placeholder: campo ? "" : "— vazio —" },
	});

	seletor.addEventListener("input", () => {
		entradaHex.value = seletor.value;
	});
	seletor.addEventListener("change", () => gravar(seletor.value));
	const confirmarTexto = () => {
		const valor = entradaHex.value.trim();
		if (!valor) return;
		gravar(valor);
	};
	entradaHex.addEventListener("blur", confirmarTexto);
	entradaHex.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entradaHex.blur();
	});

	desenharBordaToggle(linha, `${papel.tokenBase}-borda`, campoBorda, acoes);

	function gravar(valor: string): void {
		cartao.removeClass("is-reserva");
		cabecalho.querySelector(".ve-ds-badge-reserva")?.remove();
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(papel.tokenBase, valor);
	}
}

interface PapelBotao {
	tokenBase: string; // "--btn-destrutivo"
	rotulo: string;
}

const PAPEIS_BOTAO: PapelBotao[] = [
	{ tokenBase: "--btn-destrutivo", rotulo: "Destrutivo" },
	{ tokenBase: "--btn-salvar", rotulo: "Salvar" },
	{ tokenBase: "--btn-cancelar", rotulo: "Cancelar" },
	{ tokenBase: "--btn-excluir", rotulo: "Excluir" },
	{ tokenBase: "--btn-arquivar", rotulo: "Arquivar" },
	{ tokenBase: "--btn-1", rotulo: "Botão 1" },
	{ tokenBase: "--btn-2", rotulo: "Botão 2" },
	{ tokenBase: "--btn-3", rotulo: "Botão 3" },
];

/** As formas oferecidas para o raio compartilhado de todos os botões de propósito. */
const FORMAS_BOTAO = [
	{ raio: "0px", rotulo: "Quadrado" },
	{ raio: "8px", rotulo: "Arred. 1" },
	{ raio: "16px", rotulo: "Arred. 2" },
	{ raio: "999px", rotulo: "Pílula" },
];

function desenharSecaoBotoes(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|botoes",
		titulo: "4. Botões",
		descricao: "Cor por propósito (o que o botão faz) e forma reutilizável (o raio de todos de uma vez, porque a forma é do sistema, não de cada botão).",
		resumo: `${PAPEIS_BOTAO.length} papéis`,
	});

	acordeao.sePreenchido((corpo) => {
		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Cor por propósito" });
		const gradeCor = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const papel of PAPEIS_BOTAO) {
			desenharCartaoCorSimples(gradeCor, papel, porToken.get(papel.tokenBase) ?? null, acoes);
		}

		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Forma (escolha uma para todos os botões acima)" });
		desenharFormaBotao(corpo, porToken, acoes);
	});
}

function desenharFormaBotao(pai: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const campoRaio = porToken.get("--btn-forma-raio") ?? null;
	const campoBorda = porToken.get("--btn-forma-borda") ?? null;
	const raioAtual = campoRaio?.valor ?? null;

	const grade = pai.createDiv({ cls: "ve-ds-grade ve-ds-grade-forma" });

	const botoes: HTMLButtonElement[] = [];
	for (const forma of FORMAS_BOTAO) {
		const cartao = grade.createDiv({ cls: "ve-ds-amostra" });
		const preview = cartao.createEl("button", {
			cls: "ve-ds-preview-botao",
			attr: { type: "button" },
			text: forma.rotulo,
		});
		preview.style.borderRadius = forma.raio;
		preview.toggleClass("is-ativa", raioAtual === forma.raio);
		botoes.push(preview);

		preview.addEventListener("click", () => {
			botoes.forEach((b) => b.removeClass("is-ativa"));
			preview.addClass("is-ativa");
			if (campoRaio) acoes.aplicarToken(campoRaio.chave, forma.raio);
			else acoes.criarToken("--btn-forma-raio", forma.raio);
		});
	}

	const cartaoBorda = grade.createDiv({ cls: "ve-ds-amostra" });
	cartaoBorda.createDiv({ cls: "ve-ds-amostra-rotulo", text: "Borda" });
	const linhaBorda = cartaoBorda.createDiv({ cls: "ve-ds-campo-valor", attr: { style: "justify-content:center" } });
	desenharBordaToggle(linhaBorda, "--btn-forma-borda", campoBorda, acoes);
}

interface PapelTipografia {
	tokenBase: string; // "--titulo-1"
	rotulo: string;
	tamanhoAmostra: string;
}

const PAPEIS_TIPOGRAFIA: PapelTipografia[] = [
	{ tokenBase: "--titulo-1", rotulo: "Título 1 · h1, h2", tamanhoAmostra: "26px" },
	{ tokenBase: "--texto-1", rotulo: "Texto 1 · corpo, parágrafo", tamanhoAmostra: "15px" },
];

const FONTES_GOOGLE = [
	"Inter", "Inter Tight", "Sono", "DM Sans", "Roboto Mono", "Zalando Sans", "Manrope", "Nunito Sans",
	"Onest", "Fragment Mono", "Red Hat Mono", "Figtree", "Parkinsans", "Google Sans", "National Park",
	"Quicksand", "Fredoka", "SN Pro",
];

function desenharSecaoTipografia(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|tipografia",
		titulo: "5. Tipografia",
		descricao: "Família, tamanho, peso, entrelinhas e espaço entre letras — cinco campos por papel.",
		resumo: `${PAPEIS_TIPOGRAFIA.length} papéis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-tipografia" });
		for (const papel of PAPEIS_TIPOGRAFIA) {
			desenharCartaoTipografia(grade, papel, porToken, acoes);
		}
	});
}

function desenharCartaoTipografia(
	pai: HTMLElement,
	papel: PapelTipografia,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const sub = (sufixo: string) => porToken.get(`${papel.tokenBase}-${sufixo}`) ?? null;
	const campoFamilia = sub("familia");
	const preenchido = !!campoFamilia;

	const cartao = pai.createDiv({ cls: "ve-ds-amostra-tipo" });
	if (!preenchido) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!preenchido) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const amostra = cartao.createDiv({ cls: "ve-ds-amostra-tipo-texto", text: "Amostra do estilo" });
	amostra.style.fontFamily = campoFamilia?.valor ?? "inherit";
	amostra.style.fontSize = papel.tamanhoAmostra;
	amostra.style.fontWeight = sub("peso")?.valor ?? "400";

	const grade = cartao.createDiv({ cls: "ve-ds-tipo-grid" });

	desenharCampoFonte(grade, `${papel.tokenBase}-familia`, campoFamilia, acoes, (valor) => {
		amostra.style.fontFamily = valor;
	});
	desenharCampoTipoTexto(grade, "tamanho", `${papel.tokenBase}-tamanho`, sub("tamanho"), acoes, (valor) => {
		amostra.style.fontSize = valor;
	});
	desenharCampoTipoTexto(grade, "peso", `${papel.tokenBase}-peso`, sub("peso"), acoes, (valor) => {
		amostra.style.fontWeight = valor;
	});
	desenharCampoTipoTexto(grade, "entrelinhas", `${papel.tokenBase}-linha`, sub("linha"), acoes);
	desenharCampoTipoTexto(grade, "letras", `${papel.tokenBase}-letra`, sub("letra"), acoes, (valor) => {
		amostra.style.letterSpacing = valor;
	});
}

function desenharCampoTipoTexto(
	pai: HTMLElement,
	rotulo: string,
	tokenBase: string,
	campo: Campo | null,
	acoes: AcoesDesignSystem,
	aoMudar?: (valor: string) => void
): void {
	const campoEl = pai.createDiv({ cls: "ve-ds-tipo-field" });
	campoEl.createEl("label", { text: rotulo });
	const entrada = campoEl.createEl("input", {
		attr: { type: "text", spellcheck: "false", value: campo?.valor ?? "" },
	});

	const confirmar = () => {
		const valor = entrada.value.trim();
		if (!valor) return;
		aoMudar?.(valor);
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(tokenBase, valor);
	};
	entrada.addEventListener("blur", confirmar);
	entrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entrada.blur();
	});
}

function desenharCampoFonte(
	pai: HTMLElement,
	tokenBase: string,
	campo: Campo | null,
	acoes: AcoesDesignSystem,
	aoMudar: (valor: string) => void
): void {
	const campoEl = pai.createDiv({ cls: "ve-ds-tipo-field" });
	campoEl.createEl("label", { text: "família" });

	const valorAtual = campo?.valor ?? "";
	const conhecida = FONTES_GOOGLE.includes(valorAtual);

	const select = campoEl.createEl("select");
	for (const fonte of FONTES_GOOGLE) {
		const opcao = select.createEl("option", { text: fonte, value: fonte });
		if (fonte === valorAtual) opcao.selected = true;
	}
	const opcaoOutra = select.createEl("option", { text: "Outra…", value: "__outra__" });
	if (valorAtual && !conhecida) opcaoOutra.selected = true;

	const entradaOutra = campoEl.createEl("input", {
		cls: "ve-ds-outra-fonte",
		attr: { type: "text", placeholder: "nome da fonte", value: !conhecida ? valorAtual : "" },
	});
	entradaOutra.toggleClass("is-oculto", conhecida || !valorAtual);

	const gravar = (valor: string) => {
		if (!valor.trim()) return;
		aoMudar(valor);
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(tokenBase, valor);
	};

	select.addEventListener("change", () => {
		if (select.value === "__outra__") {
			entradaOutra.removeClass("is-oculto");
			entradaOutra.focus();
			return;
		}
		entradaOutra.addClass("is-oculto");
		gravar(select.value);
	});

	entradaOutra.addEventListener("blur", () => gravar(entradaOutra.value));
	entradaOutra.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entradaOutra.blur();
	});
}

interface PapelSombra {
	tokenBase: string; // "--sombra-1"
	rotulo: string;
}

const PAPEIS_SOMBRA: PapelSombra[] = [
	{ tokenBase: "--sombra-1", rotulo: "Sombra 1 · card" },
	{ tokenBase: "--sombra-2", rotulo: "Sombra 2 · botão hover" },
];

function desenharSecaoSombra(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|sombra",
		titulo: "6. Sombra",
		descricao: "Cor, deslocamento e desfoque de cada sombra, com uma prévia ao lado.",
		resumo: `${PAPEIS_SOMBRA.length} papéis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-sombra" });
		for (const papel of PAPEIS_SOMBRA) {
			desenharCartaoSombra(grade, papel, porToken, acoes);
		}
	});
}

function desenharCartaoSombra(
	pai: HTMLElement,
	papel: PapelSombra,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const sub = (sufixo: string) => porToken.get(`${papel.tokenBase}-${sufixo}`) ?? null;
	const campoCor = sub("cor");
	const campoX = sub("x");
	const campoY = sub("y");
	const campoBlur = sub("blur");
	const preenchido = !!campoCor;

	const cartao = pai.createDiv({ cls: "ve-ds-amostra-sombra" });
	if (!preenchido) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!preenchido) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const preview = cartao.createDiv({ cls: "ve-ds-preview-sombra" });
	const atualizarPreview = () => {
		const cor = campoCor?.valor ?? entradaCor?.value ?? "#000000";
		const x = entradaX?.value ?? "0";
		const y = entradaY?.value ?? "0";
		const blur = entradaBlur?.value ?? "0";
		preview.style.boxShadow = `${x}px ${y}px ${blur}px ${cor}`;
	};

	const linha = cartao.createDiv({ cls: "ve-ds-camada-sombra" });
	const entradaCor = linha.createEl("input", {
		cls: "ve-ds-sombra-cor",
		attr: { type: "color", value: valorParaSeletor(campoCor?.valor) },
	});
	const entradaX = linha.createEl("input", {
		cls: "ve-ds-sombra-mini",
		attr: { type: "text", value: campoX?.valor?.replace(/px$/, "") ?? "0", "aria-label": "Deslocamento X" },
	});
	const entradaY = linha.createEl("input", {
		cls: "ve-ds-sombra-mini",
		attr: { type: "text", value: campoY?.valor?.replace(/px$/, "") ?? "0", "aria-label": "Deslocamento Y" },
	});
	const entradaBlur = linha.createEl("input", {
		cls: "ve-ds-sombra-mini",
		attr: { type: "text", value: campoBlur?.valor?.replace(/px$/, "") ?? "0", "aria-label": "Desfoque" },
	});

	entradaCor.addEventListener("input", atualizarPreview);
	entradaCor.addEventListener("change", () => {
		gravar(campoCor, `${papel.tokenBase}-cor`, entradaCor.value);
		atualizarPreview();
	});
	const ligarCampoMedida = (entrada: HTMLInputElement, campo: Campo | null, sufixo: string) => {
		const confirmar = () => {
			const numero = entrada.value.trim();
			if (!numero) return;
			gravar(campo, `${papel.tokenBase}-${sufixo}`, `${numero}px`);
			atualizarPreview();
		};
		entrada.addEventListener("blur", confirmar);
		entrada.addEventListener("keydown", (evento) => {
			if (evento.key === "Enter") entrada.blur();
		});
	};
	ligarCampoMedida(entradaX, campoX, "x");
	ligarCampoMedida(entradaY, campoY, "y");
	ligarCampoMedida(entradaBlur, campoBlur, "blur");

	function gravar(campoExistente: Campo | null, tokenBase: string, valor: string): void {
		cartao.removeClass("is-reserva");
		cabecalho.querySelector(".ve-ds-badge-reserva")?.remove();
		if (campoExistente) acoes.aplicarToken(campoExistente.chave, valor);
		else acoes.criarToken(tokenBase, valor);
	}

	atualizarPreview();
}

interface PapelEspacoRaio {
	tokenBase: string;
	rotulo: string;
	tipo: "raio" | "espaco";
}

const PAPEIS_ESPACO_RAIO: PapelEspacoRaio[] = [
	{ tokenBase: "--card-1-raio", rotulo: "Raio Card", tipo: "raio" },
	{ tokenBase: "--espaco-1", rotulo: "Espaço 1 · respiro entre blocos", tipo: "espaco" },
];

function desenharSecaoEspacoRaio(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|espaco-raio",
		titulo: "7. Espaço e Raio",
		descricao: "Medidas reutilizáveis: o quanto uma borda arredonda, o quanto um respiro separa.",
		resumo: `${PAPEIS_ESPACO_RAIO.length} papéis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const papel of PAPEIS_ESPACO_RAIO) {
			desenharCartaoMedida(grade, papel, porToken.get(papel.tokenBase) ?? null, acoes);
		}
	});
}

function desenharCartaoMedida(pai: HTMLElement, papel: PapelEspacoRaio, campo: Campo | null, acoes: AcoesDesignSystem): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	if (!campo) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!campo) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const preview = cartao.createDiv({ cls: "ve-ds-preview-medida" });
	if (papel.tipo === "raio") {
		preview.style.borderRadius = campo?.valor ?? "0px";
	} else {
		const a = preview.createDiv({ cls: "ve-ds-espaco-bloco" });
		const b = preview.createDiv({ cls: "ve-ds-espaco-bloco" });
		a.style.marginRight = campo?.valor ?? "0px";
		void b;
	}

	const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	const entrada = linha.createEl("input", {
		cls: "ve-ds-entrada-hex-inline",
		attr: { type: "text", spellcheck: "false", value: campo?.valor ?? "", placeholder: campo ? "" : "— vazio —" },
	});

	const confirmar = () => {
		const valor = entrada.value.trim();
		if (!valor) return;
		if (papel.tipo === "raio") preview.style.borderRadius = valor;
		else (preview.firstElementChild as HTMLElement | null)?.style.setProperty("margin-right", valor);
		cartao.removeClass("is-reserva");
		cabecalho.querySelector(".ve-ds-badge-reserva")?.remove();
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(papel.tokenBase, valor);
	};
	entrada.addEventListener("blur", confirmar);
	entrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entrada.blur();
	});
}

interface PapelAlerta {
	tokenBase: string;
	rotulo: string;
	icone: string;
	mensagem: string;
}

const PAPEIS_ALERTA: PapelAlerta[] = [
	{ tokenBase: "--alerta-default", rotulo: "Alerta padrão", icone: "ⓘ", mensagem: "Mensagem informativa neutra." },
	{ tokenBase: "--alerta-erro", rotulo: "Erro", icone: "⚠", mensagem: "Algo deu errado, tente novamente." },
	{ tokenBase: "--alerta-sucesso", rotulo: "Sucesso", icone: "✓", mensagem: "Alterações salvas com sucesso." },
	{ tokenBase: "--alerta-aviso", rotulo: "Aviso", icone: "△", mensagem: "Revise as mudanças antes de continuar." },
];

function desenharSecaoAlerts(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|alerts",
		titulo: "8. Alerts",
		descricao: "A cor da faixa lateral de cada estado de alerta.",
		resumo: `${PAPEIS_ALERTA.length} papéis`,
	});

	acordeao.sePreenchido((corpo) => {
		const grade = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-alertas" });
		for (const papel of PAPEIS_ALERTA) {
			desenharCartaoAlerta(grade, papel, porToken.get(papel.tokenBase) ?? null, acoes);
		}
	});
}

function desenharCartaoAlerta(pai: HTMLElement, papel: PapelAlerta, campo: Campo | null, acoes: AcoesDesignSystem): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra-alerta" });
	if (!campo) cartao.addClass("is-reserva");
	cartao.style.borderLeftColor = campo?.valor ?? "var(--background-modifier-border)";

	cartao.createSpan({ cls: "ve-ds-amostra-alerta-icone", text: papel.icone });
	const corpo = cartao.createDiv({ cls: "ve-ds-amostra-alerta-corpo" });
	const cabecalho = corpo.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!campo) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });
	corpo.createSpan({ cls: "ve-ds-amostra-alerta-msg", text: papel.mensagem });

	const linha = corpo.createDiv({ cls: "ve-ds-campo-valor" });
	const seletor = linha.createEl("input", { attr: { type: "color", value: valorParaSeletor(campo?.valor) } });
	const entradaHex = linha.createEl("input", {
		cls: "ve-ds-entrada-hex-inline",
		attr: { type: "text", spellcheck: "false", value: campo?.valor ?? "", placeholder: campo ? "" : "— vazio —" },
	});

	seletor.addEventListener("input", () => {
		entradaHex.value = seletor.value;
		cartao.style.borderLeftColor = seletor.value;
	});
	seletor.addEventListener("change", () => gravar(seletor.value));
	const confirmarTexto = () => {
		const valor = entradaHex.value.trim();
		if (!valor) return;
		cartao.style.borderLeftColor = valor;
		gravar(valor);
	};
	entradaHex.addEventListener("blur", confirmarTexto);
	entradaHex.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entradaHex.blur();
	});

	function gravar(valor: string): void {
		cartao.removeClass("is-reserva");
		cabecalho.querySelector(".ve-ds-badge-reserva")?.remove();
		if (campo) acoes.aplicarToken(campo.chave, valor);
		else acoes.criarToken(papel.tokenBase, valor);
	}
}
