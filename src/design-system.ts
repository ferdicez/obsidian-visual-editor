import { setIcon } from "obsidian";
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
	/** Abre a busca de ícones Lucide. */
	abrirSeletorIcone: (aoEscolher: (icone: string) => void) => void;
	/** Troca entre editar o modo claro (:root/@theme) e o escuro (.dark) — redesenha a aba. */
	trocarModoTema: (modo: "claro" | "escuro") => void;
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

export type ModoTema = "claro" | "escuro";

/**
 * Escolhe, para cada nome de token, o campo do modo pedido — `.dark` para escuro, qualquer outro
 * grupo (`:root`, `@theme…`) para claro. Cai no campo claro quando não há um escuro ainda: é assim
 * que um papel sem valor próprio no `.dark` aparece "de reserva" no modo escuro sem quebrar nada.
 *
 * `lerCss` já lê declarações repetidas do mesmo nome como campos distintos (`chave` ganha sufixo
 * `@2`, `@3…`), então um token dentro de `.dark` já chega aqui como um `Campo` de verdade — nenhuma
 * mudança no parser foi necessária para a LEITURA, só para a criação (`declararVariavelDark`).
 */
function porTokenNoModo(campos: Campo[], modo: ModoTema): Map<string, Campo> {
	const porNome = new Map<string, Campo[]>();
	for (const campo of campos) {
		if (campo.papel === "propriedade") continue;
		const lista = porNome.get(campo.nomeReal) ?? [];
		lista.push(campo);
		porNome.set(campo.nomeReal, lista);
	}

	const resultado = new Map<string, Campo>();
	for (const [nome, lista] of porNome) {
		const doDark = lista.find((c) => c.grupo === ".dark");
		const doClaro = lista.find((c) => c.grupo !== ".dark") ?? lista[0];
		const escolhido = modo === "escuro" ? doDark ?? doClaro : doClaro;
		resultado.set(nome, escolhido);
	}
	return resultado;
}

export function desenharDesignSystem(
	pai: HTMLElement,
	campos: Campo[],
	formato: Formato,
	modo: ModoTema,
	acoes: AcoesDesignSystem
): void {
	const raiz = pai.createDiv({ cls: "ve-ds" });

	if (formato !== "css") {
		raiz.createDiv({
			cls: "ve-ds-aviso",
			text: "O catálogo de Design System só está disponível para arquivos CSS — é onde tokens (--nome: valor) fazem sentido.",
		});
		return;
	}

	desenharAlternadorTema(raiz, modo, acoes);

	const porToken = porTokenNoModo(campos, modo);

	desenharSecaoCoresPrincipais(raiz, porToken, acoes);
	desenharSecaoStatus(raiz, porToken, acoes);
	desenharSecaoGruposFuncionais(raiz, porToken, acoes);
	desenharSecaoCards(raiz, porToken, acoes);
	desenharSecaoBotoes(raiz, porToken, acoes);
	desenharSecaoIcones(raiz, porToken, acoes);
	desenharSecaoTipografia(raiz, porToken, acoes);
	desenharSecaoSombra(raiz, porToken, acoes);
	desenharSecaoEspacoRaio(raiz, porToken, acoes);
	desenharSecaoAlerts(raiz, porToken, acoes);
}

/**
 * O interruptor Claro/Escuro no topo da aba: decide se os cartões abaixo leem e gravam no `:root`
 * (ou `@theme`) ou dentro de `.dark`. Pedido dela: os tokens do modo escuro devem ficar dentro de um
 * seletor `.dark` — o padrão Tailwind/shadcn, onde essa classe na tag `<html>` troca os valores
 * sozinha, sem precisar duplicar CSS em outro lugar do projeto.
 */
function desenharAlternadorTema(raiz: HTMLElement, modo: ModoTema, acoes: AcoesDesignSystem): void {
	const barra = raiz.createDiv({ cls: "ve-ds-alternador-tema" });

	const criarBotao = (valor: ModoTema, rotulo: string) => {
		const botao = barra.createEl("button", { cls: "ve-ds-alternador-botao", attr: { type: "button" }, text: rotulo });
		botao.toggleClass("is-ativo", modo === valor);
		botao.addEventListener("click", () => {
			if (modo === valor) return;
			acoes.trocarModoTema(valor);
		});
	};

	criarBotao("claro", "Claro");
	criarBotao("escuro", "Escuro");

	if (modo === "escuro") {
		barra.createDiv({
			cls: "ve-ds-alternador-nota",
			text: "Editando os valores dentro de .dark — o que não tiver valor aqui usa o do modo claro.",
		});
	}
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
 *
 * `raio` é opcional: só a seção Botões passa a forma escolhida, para o retângulo já nascer com o
 * arredondamento certo — pedido dela, escolher a forma primeiro e ver refletido nos cartões abaixo.
 */
function desenharCartaoCorSimples(
	pai: HTMLElement,
	papel: Papel,
	campo: Campo | null,
	acoes: AcoesDesignSystem,
	raio?: string | null
): void {
	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	if (!campo) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!campo) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const bloco = cartao.createDiv({ cls: "ve-ds-bloco-cor" });
	bloco.style.background = campo?.valor ?? "var(--background-primary)";
	if (raio) bloco.style.borderRadius = raio;

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
				hex,
				(novo) => {
					// Só a prévia local: gravar a cada arraste redesenharia a tela e cortaria o slider.
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

/** Um grupo de forma: raio + borda + sombra, que um ou mais cards podem compartilhar. */
interface GrupoForma {
	id: string; // "a", "b", "c" — vai dentro do nome do token e no valor gravado em -grupo
	rotulo: string;
}

const GRUPOS_FORMA_CARD: GrupoForma[] = [
	{ id: "a", rotulo: "Forma A" },
	{ id: "b", rotulo: "Forma B" },
	{ id: "c", rotulo: "Forma C" },
];

function desenharSecaoGruposFuncionais(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|grupos-funcionais",
		titulo: "3. Background e Texto",
		descricao: "Cinco opções de fundo e cinco de cor de texto.",
		resumo: "10 papéis",
	});

	acordeao.sePreenchido((corpo) => {
		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Background" });
		const gradeBg = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const papel of PAPEIS_BACKGROUND) desenharCartaoCorSimples(gradeBg, papel, porToken.get(papel.tokenBase) ?? null, acoes);

		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Texto" });
		const gradeTexto = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const papel of PAPEIS_TEXTO) desenharCartaoCorTexto(gradeTexto, papel, porToken.get(papel.tokenBase) ?? null, acoes);
	});
}

/**
 * Cards, em bloco próprio (era subseção de "Background, Texto e Cards" — pedido dela: *"card pode
 * ter um campo só dele"*).
 *
 * Em vez de UM raio+borda compartilhado por todos os cards, há vários GRUPOS DE FORMA
 * (`GRUPOS_FORMA_CARD`: A, B, C — cada um com o próprio raio, borda e sombra), e cada card escolhe
 * qual grupo usar. Pedido dela: *"eu quero que um card tenha sombra e outro não, eu quero que um
 * card tenha borda e outro tipo de card não (...) às vezes um card que aparece centralizado, eu
 * quero que esse card tenha uma margem maior"* — um raio único para todos não permitiria isso.
 *
 * As formas vêm PRIMEIRO, e os cards depois: mesma lógica de "escolher antes de ver o resultado"
 * que a forma dos Botões já usa — trocar o grupo de um card já reflete no preview dele na hora.
 */
function desenharSecaoCards(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|cards",
		titulo: "4. Cards",
		descricao: "Grupos de forma (raio, borda, sombra) que os cards abaixo escolhem — um card pode ter sombra e borda, outro não, sem duplicar a definição inteira.",
		resumo: `${PAPEIS_CARD.length} papéis`,
	});

	acordeao.sePreenchido((corpo) => {
		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Grupos de forma" });
		const gradeFormas = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-forma-card" });
		for (const grupo of GRUPOS_FORMA_CARD) {
			desenharGrupoFormaCard(gradeFormas, grupo, porToken, acoes);
		}

		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Cards" });
		const gradeCard = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-cards" });
		for (const papel of PAPEIS_CARD) {
			desenharCartaoCard(gradeCard, papel, porToken.get(papel.tokenBase) ?? null, porToken, acoes);
		}
	});
}

/** Um grupo de forma: raio, borda liga/desliga, e sombra opcional (nenhuma / Sombra 1 / Sombra 2). */
function desenharGrupoFormaCard(
	pai: HTMLElement,
	grupo: GrupoForma,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const baseToken = `--card-forma-${grupo.id}`;
	const campoRaio = porToken.get(`${baseToken}-raio`) ?? null;
	const campoBorda = porToken.get(`${baseToken}-borda`) ?? null;
	const campoSombra = porToken.get(`${baseToken}-sombra`) ?? null;

	const cartao = pai.createDiv({ cls: "ve-ds-amostra ve-ds-amostra-forma-card" });
	cartao.createDiv({ cls: "ve-ds-amostra-rotulo", text: grupo.rotulo });

	const preview = cartao.createDiv({ cls: "ve-ds-preview-medida" });
	preview.style.borderRadius = campoRaio?.valor ?? "0px";
	aplicarSombraPreview(preview, campoSombra?.valor);

	const linhaRaio = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	desenharSliderMedida(linhaRaio, `${baseToken}-raio`, campoRaio, acoes, { min: 0, max: 40 }, (valor) => {
		preview.style.borderRadius = valor;
	});

	const linhaBorda = cartao.createDiv({ cls: "ve-ds-campo-valor ve-ds-campo-valor-coluna" });
	desenharBordaToggle(linhaBorda, `${baseToken}-borda`, campoBorda, acoes, {
		candidatas: coresDisponiveis(porToken),
		campoCor: porToken.get(`${baseToken}-borda-cor`) ?? null,
	});

	const linhaSombra = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	desenharSeletorSombra(linhaSombra, `${baseToken}-sombra`, campoSombra, acoes, (valor) => {
		aplicarSombraPreview(preview, valor);
	});
}

/** `""`/`"none"` → sem sombra; `"--sombra-1"`/`"--sombra-2"` → referencia o token da seção Sombra. */
function aplicarSombraPreview(el: HTMLElement, valor: string | undefined): void {
	el.style.boxShadow = valor && valor !== "none" ? `var(${valor})` : "none";
}

/** Nenhuma / Sombra 1 / Sombra 2 — as duas sombras já cadastradas na seção 7. */
function desenharSeletorSombra(
	pai: HTMLElement,
	tokenBase: string,
	campo: Campo | null,
	acoes: AcoesDesignSystem,
	aoMudar: (valor: string) => void
): void {
	const OPCOES = [
		{ valor: "none", rotulo: "sem sombra" },
		{ valor: "--sombra-1", rotulo: "Sombra 1" },
		{ valor: "--sombra-2", rotulo: "Sombra 2" },
	];
	const valorAtual = campo?.valor ?? "none";

	const select = pai.createEl("select", { cls: "ve-ds-select-sombra" });
	for (const opcao of OPCOES) {
		const el = select.createEl("option", { text: opcao.rotulo, value: opcao.valor });
		if (opcao.valor === valorAtual) el.selected = true;
	}

	select.addEventListener("change", () => {
		aoMudar(select.value);
		if (campo) acoes.aplicarToken(campo.chave, select.value);
		else acoes.criarToken(tokenBase, select.value);
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

/** Um token de cor já existente no arquivo, oferecido como opção pronta na borda. */
interface OpcaoCorToken {
	nomeReal: string; // "--bg-2" — o que é gravado como var(--bg-2)
	rotulo: string; // "Background 2" — o que aparece no menu
}

/**
 * Todos os tokens de cor já declarados no arquivo, para oferecer como cor de borda — pedido dela:
 * *"a cor dessa borda inclusive pode ser uma variável das cores que eu selecionei lá em cima, entre
 * os backgrounds e as cores secundárias"*. Cresce junto com o catálogo: quanto mais papéis ela
 * preenche, mais opções aparecem aqui — não é uma lista curada à parte.
 */
function coresDisponiveis(porToken: Map<string, Campo>): OpcaoCorToken[] {
	return Array.from(porToken.values())
		.filter((campo) => campo.tipo === "cor")
		.map((campo) => ({ nomeReal: campo.nomeReal, rotulo: campo.rotulo }))
		.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

/**
 * O interruptor liga/desliga de borda, reaproveitado por Cards e pela forma dos Botões e Ícones.
 *
 * `corOpcoes` é opcional: quando presente, um seletor de cor aparece ao lado — só visível com a
 * borda ligada — oferecendo "usar a cor do texto" (o padrão, sem token de cor próprio) ou qualquer
 * token de cor já declarado no arquivo. Escolher um token grava `var(--token)` no valor, não o hex:
 * a borda continua acompanhando aquele papel se ele mudar de cor depois.
 */
function desenharBordaToggle(
	pai: HTMLElement,
	tokenBorda: string,
	campoBorda: Campo | null,
	acoes: AcoesDesignSystem,
	corOpcoes?: { candidatas: OpcaoCorToken[]; campoCor: Campo | null }
): void {
	const ligada = campoBorda?.valor?.trim() === "1";

	const toggle = pai.createDiv({ cls: "ve-ds-borda-toggle" });
	const chave = toggle.createSpan({ cls: "ve-ds-mini-switch" });
	if (ligada) chave.addClass("is-ligado");
	toggle.createSpan({ text: "borda" });

	let selectCor: HTMLSelectElement | null = null;
	if (corOpcoes) {
		selectCor = pai.createEl("select", { cls: "ve-ds-select-sombra ve-ds-select-cor-borda" });
		selectCor.toggleClass("is-oculto", !ligada);

		const valorAtual = corOpcoes.campoCor?.valor ?? "";
		const opcaoPadrao = selectCor.createEl("option", { text: "cor do texto", value: "" });
		if (!valorAtual) opcaoPadrao.selected = true;

		for (const opcao of corOpcoes.candidatas) {
			const tokenCss = `var(${opcao.nomeReal})`;
			const el = selectCor.createEl("option", { text: opcao.rotulo, value: tokenCss });
			if (valorAtual === tokenCss) el.selected = true;
		}

		selectCor.addEventListener("change", () => {
			const valor = selectCor!.value;
			const tokenCor = `${tokenBorda}-cor`;
			if (corOpcoes!.campoCor) acoes.aplicarToken(corOpcoes!.campoCor.chave, valor);
			else if (valor) acoes.criarToken(tokenCor, valor);
		});
	}

	toggle.setAttr("role", "button");
	toggle.addEventListener("click", () => {
		const novoValor = ligada ? "0" : "1";
		chave.toggleClass("is-ligado", !ligada);
		selectCor?.toggleClass("is-oculto", ligada);
		if (campoBorda) acoes.aplicarToken(campoBorda.chave, novoValor);
		else acoes.criarToken(tokenBorda, novoValor);
	});
}

/**
 * Slider + campo numérico para uma medida em px (raio, espaçamento) — mesmas classes `.ve-slider`/
 * `.ve-entrada-numero` que o resto do plugin já usa em `controles.ts`, para o controle ficar igual
 * ao de qualquer outro campo de medida do Visual Editor. Pedido dela: digitar era a única forma
 * antes, e um slider ajuda a explorar o valor sem ter que adivinhar o número.
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

/**
 * Um card: cor de fundo + qual GRUPO DE FORMA ele usa (`--card-N-grupo: "a"`, texto simples). O
 * preview aplica o raio/borda/sombra do grupo escolhido, então trocar o grupo no seletor já muda a
 * cara do card na hora — sem precisar abrir "Grupos de forma" de novo para conferir.
 */
function desenharCartaoCard(
	pai: HTMLElement,
	papel: PapelCard,
	campo: Campo | null,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const campoGrupo = porToken.get(`${papel.tokenBase}-grupo`) ?? null;
	const grupoAtual = campoGrupo?.valor?.replace(/^"|"$/g, "") || GRUPOS_FORMA_CARD[0].id;

	const cartao = pai.createDiv({ cls: "ve-ds-amostra-card" });
	if (!campo) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!campo) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const aplicarForma = (idGrupo: string) => {
		const base = `--card-forma-${idGrupo}`;
		cartao.style.borderRadius = `var(${base}-raio, 0px)`;
		cartao.style.boxShadow = `var(${base}-sombra, none)`;
	};
	aplicarForma(grupoAtual);

	// Sem <h4> de exemplo: o rótulo do cabeçalho ("Card 1 · cartão padrão") já identifica o papel —
	// repetir "Título do card" dentro do preview era redundante.
	if (campo) {
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

	const linhaGrupo = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	linhaGrupo.createSpan({ cls: "ve-ds-rotulo-inline", text: "forma" });
	const selectGrupo = linhaGrupo.createEl("select", { cls: "ve-ds-select-sombra" });
	for (const grupo of GRUPOS_FORMA_CARD) {
		const opcao = selectGrupo.createEl("option", { text: grupo.rotulo, value: grupo.id });
		if (grupo.id === grupoAtual) opcao.selected = true;
	}
	selectGrupo.addEventListener("change", () => {
		aplicarForma(selectGrupo.value);
		const valor = `"${selectGrupo.value}"`;
		if (campoGrupo) acoes.aplicarToken(campoGrupo.chave, valor);
		else acoes.criarToken(`${papel.tokenBase}-grupo`, valor);
	});

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
		titulo: "5. Botões",
		descricao: "Cor por propósito (o que o botão faz) e forma reutilizável (o raio de todos de uma vez, porque a forma é do sistema, não de cada botão).",
		resumo: `${PAPEIS_BOTAO.length} papéis`,
	});

	acordeao.sePreenchido((corpo) => {
		// A forma vem PRIMEIRO: ela decide o raio que os cartões de cor abaixo já nascem mostrando —
		// escolher depois de ver os botões sem raio nenhum era o inverso do que ela queria.
		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Forma (aplica a todos os botões abaixo)" });
		const raioAtual = desenharFormaBotao(corpo, porToken, acoes);

		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Cor por propósito" });
		const gradeCor = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const papel of PAPEIS_BOTAO) {
			desenharCartaoCorSimples(gradeCor, papel, porToken.get(papel.tokenBase) ?? null, acoes, raioAtual);
		}
	});
}

/** Devolve o raio atualmente escolhido (ou `null` se ainda não há um), para os cartões de cor abaixo. */
function desenharFormaBotao(pai: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): string | null {
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
	const linhaBorda = cartaoBorda.createDiv({ cls: "ve-ds-campo-valor ve-ds-campo-valor-coluna" });
	desenharBordaToggle(linhaBorda, "--btn-forma-borda", campoBorda, acoes, {
		candidatas: coresDisponiveis(porToken),
		campoCor: porToken.get("--btn-forma-borda-cor") ?? null,
	});

	return raioAtual;
}

interface PapelIcone {
	tokenBase: string; // "--icone-buscar"
	rotulo: string;
	iconePadrao: string; // nome Lucide sugerido antes dela escolher outro
}

/**
 * Papéis de ícone prontos — os botões e ações mais comuns de um sistema. Pedido dela: *"às vezes eu
 * vou criar um sistema e aí o sistema tem um botão de procurar, tem um botão de adicionar, tem um
 * botão de salvar (...) eu acho que você pode botar pelo menos uns 10 ícones"*. Cada um já vem com
 * um ícone Lucide sugerido — ela troca clicando, não precisa escolher os 10 do zero.
 */
const PAPEIS_ICONE: PapelIcone[] = [
	{ tokenBase: "--icone-buscar", rotulo: "Buscar", iconePadrao: "search" },
	{ tokenBase: "--icone-adicionar", rotulo: "Adicionar", iconePadrao: "plus" },
	{ tokenBase: "--icone-salvar", rotulo: "Salvar", iconePadrao: "save" },
	{ tokenBase: "--icone-editar", rotulo: "Editar", iconePadrao: "pencil" },
	{ tokenBase: "--icone-excluir", rotulo: "Excluir", iconePadrao: "trash-2" },
	{ tokenBase: "--icone-fechar", rotulo: "Fechar", iconePadrao: "x" },
	{ tokenBase: "--icone-voltar", rotulo: "Voltar", iconePadrao: "arrow-left" },
	{ tokenBase: "--icone-avancar", rotulo: "Avançar", iconePadrao: "arrow-right" },
	{ tokenBase: "--icone-menu", rotulo: "Menu", iconePadrao: "menu" },
	{ tokenBase: "--icone-config", rotulo: "Configurações", iconePadrao: "settings" },
];

/** Um grupo de exibição: como o ícone aparece — sozinho, ou com um fundo (círculo/quadrado). */
interface GrupoIcone {
	id: string; // vai dentro do token e no valor gravado em -grupo
	rotulo: string;
	raioFundo: string; // "999px" (círculo), "8px" (quadrado), ou "" (sem fundo)
}

const GRUPOS_EXIBICAO_ICONE: GrupoIcone[] = [
	{ id: "solo", rotulo: "Sozinho", raioFundo: "" },
	{ id: "circulo", rotulo: "Com fundo circular", raioFundo: "999px" },
	{ id: "quadrado", rotulo: "Com fundo quadrado", raioFundo: "8px" },
];

/**
 * Ícones, no mesmo padrão de Cards: grupos de EXIBIÇÃO primeiro (como o ícone aparece — pedido dela:
 * *"às vezes eu quero que o ícone seja exibido dentro de uma bolinha e o botão não quero que seja
 * numa bolinha"*), papéis de ícone depois, cada um escolhendo um grupo. `--icone-forma-N-cor` é o
 * fundo do grupo; o ícone em si sempre usa a cor de texto corrente (`currentColor`), então não
 * precisa de token de cor próprio por papel.
 */
function desenharSecaoIcones(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|icones",
		titulo: "6. Ícones",
		descricao: "Ícones do pacote Lucide para as ações mais comuns, com grupos de exibição reutilizáveis — sozinho, com fundo circular, com fundo quadrado.",
		resumo: `${PAPEIS_ICONE.length} papéis`,
	});

	acordeao.sePreenchido((corpo) => {
		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Grupos de exibição" });
		const gradeGrupos = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-forma" });
		for (const grupo of GRUPOS_EXIBICAO_ICONE) {
			desenharGrupoExibicaoIcone(gradeGrupos, grupo, porToken, acoes);
		}

		corpo.createDiv({ cls: "ve-ds-rotulo-grupo", text: "Ícones" });
		const gradeIcones = corpo.createDiv({ cls: "ve-ds-grade ve-ds-grade-amostras" });
		for (const papel of PAPEIS_ICONE) {
			desenharCartaoIcone(gradeIcones, papel, porToken, acoes);
		}
	});
}

function desenharGrupoExibicaoIcone(
	pai: HTMLElement,
	grupo: GrupoIcone,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const tokenCor = `--icone-forma-${grupo.id}-cor`;
	const campoCor = porToken.get(tokenCor) ?? null;

	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	cartao.createDiv({ cls: "ve-ds-amostra-rotulo", text: grupo.rotulo });

	const preview = cartao.createDiv({ cls: "ve-ds-preview-icone" });
	const bolha = preview.createDiv({ cls: "ve-ds-icone-bolha" });
	if (grupo.raioFundo) {
		bolha.style.borderRadius = grupo.raioFundo;
		bolha.style.background = campoCor?.valor ?? "var(--background-modifier-border)";
	} else {
		bolha.addClass("is-sem-fundo");
	}
	setIconeLucide(bolha, "star");

	if (grupo.raioFundo) {
		const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
		const seletor = linha.createEl("input", { attr: { type: "color", value: valorParaSeletor(campoCor?.valor) } });
		const entradaHex = linha.createEl("input", {
			cls: "ve-ds-entrada-hex-inline",
			attr: { type: "text", spellcheck: "false", value: campoCor?.valor ?? "", placeholder: campoCor ? "" : "— vazio —" },
		});
		seletor.addEventListener("input", () => {
			entradaHex.value = seletor.value;
			bolha.style.background = seletor.value;
		});
		seletor.addEventListener("change", () => gravar(seletor.value));
		const confirmarTexto = () => {
			const valor = entradaHex.value.trim();
			if (!valor) return;
			bolha.style.background = valor;
			gravar(valor);
		};
		entradaHex.addEventListener("blur", confirmarTexto);
		entradaHex.addEventListener("keydown", (evento) => {
			if (evento.key === "Enter") entradaHex.blur();
		});
	}

	function gravar(valor: string): void {
		if (campoCor) acoes.aplicarToken(campoCor.chave, valor);
		else acoes.criarToken(tokenCor, valor);
	}
}

function desenharCartaoIcone(
	pai: HTMLElement,
	papel: PapelIcone,
	porToken: Map<string, Campo>,
	acoes: AcoesDesignSystem
): void {
	const campoIcone = porToken.get(papel.tokenBase) ?? null;
	const campoGrupo = porToken.get(`${papel.tokenBase}-grupo`) ?? null;
	const nomeIcone = campoIcone?.valor?.replace(/^"|"$/g, "") || papel.iconePadrao;
	const grupoAtual = campoGrupo?.valor?.replace(/^"|"$/g, "") || GRUPOS_EXIBICAO_ICONE[0].id;

	const cartao = pai.createDiv({ cls: "ve-ds-amostra" });
	if (!campoIcone) cartao.addClass("is-reserva");

	const cabecalho = cartao.createDiv({ cls: "ve-ds-amostra-rotulo" });
	cabecalho.createSpan({ text: papel.rotulo });
	if (!campoIcone) cabecalho.createSpan({ cls: "ve-ds-badge-reserva", text: "reserva" });

	const preview = cartao.createDiv({ cls: "ve-ds-preview-icone" });
	const bolha = preview.createDiv({ cls: "ve-ds-icone-bolha" });

	const aplicarGrupo = (idGrupo: string) => {
		const grupo = GRUPOS_EXIBICAO_ICONE.find((g) => g.id === idGrupo) ?? GRUPOS_EXIBICAO_ICONE[0];
		bolha.toggleClass("is-sem-fundo", !grupo.raioFundo);
		bolha.style.borderRadius = grupo.raioFundo || "";
		bolha.style.background = grupo.raioFundo ? `var(--icone-forma-${grupo.id}-cor, var(--background-modifier-border))` : "";
	};
	aplicarGrupo(grupoAtual);
	setIconeLucide(bolha, nomeIcone);

	const linhaBotao = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	const botaoIcone = linhaBotao.createEl("button", {
		cls: "ve-ds-botao-fonte",
		attr: { type: "button" },
		text: nomeIcone,
	});
	botaoIcone.addEventListener("click", () => {
		acoes.abrirSeletorIcone((icone) => {
			setIconeLucide(bolha, icone);
			botaoIcone.setText(icone);
			gravarIcone(icone);
		});
	});

	const linhaGrupo = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	linhaGrupo.createSpan({ cls: "ve-ds-rotulo-inline", text: "exibição" });
	const selectGrupo = linhaGrupo.createEl("select", { cls: "ve-ds-select-sombra" });
	for (const grupo of GRUPOS_EXIBICAO_ICONE) {
		const opcao = selectGrupo.createEl("option", { text: grupo.rotulo, value: grupo.id });
		if (grupo.id === grupoAtual) opcao.selected = true;
	}
	selectGrupo.addEventListener("change", () => {
		aplicarGrupo(selectGrupo.value);
		const valor = `"${selectGrupo.value}"`;
		if (campoGrupo) acoes.aplicarToken(campoGrupo.chave, valor);
		else acoes.criarToken(`${papel.tokenBase}-grupo`, valor);
	});

	function gravarIcone(icone: string): void {
		cartao.removeClass("is-reserva");
		cabecalho.querySelector(".ve-ds-badge-reserva")?.remove();
		const valor = `"${icone}"`;
		if (campoIcone) acoes.aplicarToken(campoIcone.chave, valor);
		else acoes.criarToken(papel.tokenBase, valor);
	}
}

/**
 * Desenha um ícone Lucide dentro de um elemento. `setIcon` é importável direto de `obsidian` sem
 * precisar de `App` — mesmo padrão que `acordeao.ts` já usa para a seta do cabeçalho.
 */
function setIconeLucide(el: HTMLElement, nome: string): void {
	el.empty();
	setIcon(el, nome);
}

interface PapelTipografia {
	tokenBase: string; // "--titulo-1"
	rotulo: string;
	tamanhoAmostra: string;
}

const PAPEIS_TIPOGRAFIA: PapelTipografia[] = [
	{ tokenBase: "--titulo-1", rotulo: "Título 1 · h1", tamanhoAmostra: "32px" },
	{ tokenBase: "--titulo-2", rotulo: "Título 2 · h2, h3", tamanhoAmostra: "22px" },
	{ tokenBase: "--subtitulo", rotulo: "Subtítulo", tamanhoAmostra: "17px" },
	{ tokenBase: "--texto-1", rotulo: "Texto 1 · corpo, parágrafo", tamanhoAmostra: "15px" },
	{ tokenBase: "--texto-2", rotulo: "Texto 2 · apoio, secundário", tamanhoAmostra: "13px" },
	{ tokenBase: "--legenda", rotulo: "Legenda", tamanhoAmostra: "11px" },
];

const FONTES_GOOGLE = [
	"Inter", "Inter Tight", "Sono", "DM Sans", "Roboto Mono", "Zalando Sans", "Manrope", "Nunito Sans",
	"Onest", "Fragment Mono", "Red Hat Mono", "Figtree", "Parkinsans", "Google Sans", "National Park",
	"Quicksand", "Fredoka", "SN Pro",
];

function desenharSecaoTipografia(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|tipografia",
		titulo: "7. Tipografia",
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

/**
 * O campo de família: um botão que abre a busca de fontes (`ModalEscolherFonte`, via
 * `acoes.abrirSeletorFonte`) — cada nome da lista escrito na própria tipografia, o que um `<select>`
 * nativo nunca deixaria fazer. "Outra…" continua como campo de texto à parte, para fontes fora do
 * catálogo de 18 — o modal de busca só escolhe entre itens conhecidos, não aceita texto livre.
 */
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
			// Reabre a busca em vez de adivinhar uma fonte — o texto livre que ela digitou aqui não
			// necessariamente está na lista conhecida.
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
		titulo: "8. Sombra",
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
	/** Raio principal ganha protótipo grande; os demais são "menorzinho" — pedido dela. */
	destaque?: boolean;
}

/**
 * Raios GENÉRICOS de reserva, para qualquer elemento do sistema que precise de arredondamento —
 * diferente do raio de Cards, que hoje mora nos grupos de forma (`GRUPOS_FORMA_CARD`) porque é
 * específico daquele componente. Pedido dela: *"eu só tenho lá uma opção de raio de borda (...)
 * quero mais opções, pelo menos umas três (...) e para cada uma delas, quero um protótipozinho"*.
 */
const PAPEIS_ESPACO_RAIO: PapelEspacoRaio[] = [
	{ tokenBase: "--raio-1", rotulo: "Raio 1 · principal", tipo: "raio", destaque: true },
	{ tokenBase: "--raio-2", rotulo: "Raio 2", tipo: "raio" },
	{ tokenBase: "--raio-3", rotulo: "Raio 3", tipo: "raio" },
	{ tokenBase: "--espaco-1", rotulo: "Espaço 1 · respiro entre blocos", tipo: "espaco" },
	{ tokenBase: "--espaco-2", rotulo: "Espaço 2", tipo: "espaco" },
];

function desenharSecaoEspacoRaio(raiz: HTMLElement, porToken: Map<string, Campo>, acoes: AcoesDesignSystem): void {
	const acordeao = criarAcordeao(raiz, {
		chave: "design-system|espaco-raio",
		titulo: "9. Espaço e Raio",
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
	if (!papel.destaque) preview.addClass("is-pequeno");

	if (papel.tipo === "raio") {
		preview.style.borderRadius = campo?.valor ?? "0px";
	} else {
		const bloco = preview.createDiv({ cls: "ve-ds-espaco-bloco" });
		preview.createDiv({ cls: "ve-ds-espaco-bloco" });
		bloco.style.marginRight = campo?.valor ?? "0px";
	}

	const linha = cartao.createDiv({ cls: "ve-ds-campo-valor" });
	const maximo = papel.tipo === "raio" ? 40 : 64;

	desenharSliderMedida(linha, papel.tokenBase, campo, acoes, { min: 0, max: maximo }, (valor) => {
		if (papel.tipo === "raio") preview.style.borderRadius = valor;
		else (preview.firstElementChild as HTMLElement | null)?.style.setProperty("margin-right", valor);
		cartao.removeClass("is-reserva");
		cabecalho.querySelector(".ve-ds-badge-reserva")?.remove();
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
		titulo: "10. Alerts",
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
