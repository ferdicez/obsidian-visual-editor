import { escreverOklch, hexParaOklch, lerOklch, oklchParaHex } from "./cor-oklch";
import { Campo } from "./tipos";

/**
 * A aba shadcn: um catálogo FIXO, sob medida para o padrão de tokens que o CLI do shadcn/ui gera
 * (`@theme inline` referenciando `:root`/`.dark`). Pedido dela: ela colou o `globals.css` que o CLI
 * criou e quer editar exatamente esses nomes, na mesma ordem em que aparecem no arquivo, com
 * `:root` e `.dark` lado a lado — sem inventar agrupamento, sem esconder o nome técnico do token.
 *
 * Diferente da aba Variáveis (catálogo genérico e sem dono) e de Tokens (lista bruta, qualquer
 * CSS): aqui os nomes são FIXOS e conhecidos de antemão — se o arquivo aberto não seguir esse
 * padrão, os blocos aparecem vazios ("de reserva"), o que é esperado (ela pediu para a aba aparecer
 * sempre, mesmo sabendo que só faz sentido de verdade nesse tipo de arquivo).
 *
 * Cor é mostrada e editada em HEX, nunca em oklch — mas o arquivo continua gravando oklch (ver
 * `cor-oklch.ts`). A conversão acontece só na hora de mostrar (oklch → hex) e de gravar (hex →
 * oklch), preservando o valor original quando ela não mexe naquele campo.
 */

export interface AcoesShadcn {
	/** Grava um valor num token que já existe no arquivo (chave do Campo). */
	aplicarToken: (chave: string, novo: string) => void;
}

/** Um token fixo do padrão shadcn: o nome real em CSS, e um rótulo curto de contexto (opcional). */
interface TokenShadcn {
	nome: string; // "--background"
}

interface BlocoShadcn {
	titulo: string;
	tokens: TokenShadcn[];
}

const BLOCOS: BlocoShadcn[] = [
	{ titulo: "1. Background e Foreground", tokens: [{ nome: "--background" }, { nome: "--foreground" }] },
	{
		titulo: "2. Fonte",
		tokens: [{ nome: "--font-sans" }, { nome: "--font-mono" }, { nome: "--font-heading" }],
	},
	{
		titulo: "3. Sidebar",
		tokens: [
			{ nome: "--sidebar-ring" },
			{ nome: "--sidebar-border" },
			{ nome: "--sidebar-accent-foreground" },
			{ nome: "--sidebar-accent" },
			{ nome: "--sidebar-primary-foreground" },
			{ nome: "--sidebar-primary" },
			{ nome: "--sidebar-foreground" },
			{ nome: "--sidebar" },
		],
	},
	{
		titulo: "4. Chart",
		tokens: [
			{ nome: "--chart-5" },
			{ nome: "--chart-4" },
			{ nome: "--chart-3" },
			{ nome: "--chart-2" },
			{ nome: "--chart-1" },
		],
	},
	{
		titulo: "5. Ring, Input e Border",
		tokens: [{ nome: "--ring" }, { nome: "--input" }, { nome: "--border" }],
	},
	{
		titulo: "6. Destructive, Accent e Muted",
		tokens: [
			{ nome: "--destructive" },
			{ nome: "--accent-foreground" },
			{ nome: "--accent" },
			{ nome: "--muted-foreground" },
			{ nome: "--muted" },
		],
	},
	{
		titulo: "7. Secondary, Primary, Popover e Card",
		tokens: [
			{ nome: "--secondary-foreground" },
			{ nome: "--secondary" },
			{ nome: "--primary-foreground" },
			{ nome: "--primary" },
			{ nome: "--popover-foreground" },
			{ nome: "--popover" },
			{ nome: "--card-foreground" },
			{ nome: "--card" },
		],
	},
];

/** Os 6 multiplicadores do `@theme inline` (`--radius-lg` é o único sem multiplicador, = --radius). */
const MULTIPLICADORES_RAIO = [
	{ nome: "--radius-sm", rotulo: "sm" },
	{ nome: "--radius-md", rotulo: "md" },
	{ nome: "--radius-xl", rotulo: "xl" },
	{ nome: "--radius-2xl", rotulo: "2xl" },
	{ nome: "--radius-3xl", rotulo: "3xl" },
	{ nome: "--radius-4xl", rotulo: "4xl" },
];

const RE_MULTIPLICADOR = /^calc\(var\(--radius\)\s*\*\s*(-?[\d.]+)\)$/;

function lerMultiplicador(valor: string): number | null {
	const m = valor.trim().match(RE_MULTIPLICADOR);
	return m ? parseFloat(m[1]) : null;
}

function gravarMultiplicador(numero: number): string {
	return `calc(var(--radius) * ${numero})`;
}

/**
 * Separa os campos do arquivo em `:root` e `.dark`, indexados pelo nome real do token.
 *
 * A comparação `campo.grupo === ".dark"` bate com o padrão exato que o CLI do shadcn/ui gera (um
 * bloco `.dark { ... }` solto, no nível de topo do arquivo). Um `.dark` aninhado — dentro de
 * `@media`, ou combinado como `:root.dark` — geraria um `grupo` diferente (`ler-css.ts` monta o
 * grupo a partir da pilha de seletores abertos), e o token cairia silenciosamente na coluna clara.
 * Fora de escopo corrigir agora: essa aba é sob medida para o padrão gerado pelo CLI, não um
 * parser genérico de temas escuros.
 */
function indexarPorModo(campos: Campo[]): { claro: Map<string, Campo>; escuro: Map<string, Campo> } {
	const claro = new Map<string, Campo>();
	const escuro = new Map<string, Campo>();
	for (const campo of campos) {
		if (campo.papel === "propriedade") continue;
		const alvo = campo.grupo === ".dark" ? escuro : claro;
		if (!alvo.has(campo.nomeReal)) alvo.set(campo.nomeReal, campo);
	}
	return { claro, escuro };
}

export function desenharShadcn(pai: HTMLElement, campos: Campo[], acoes: AcoesShadcn): void {
	const raiz = pai.createDiv({ cls: "ve-sc" });
	const { claro, escuro } = indexarPorModo(campos);

	const cabecalho = raiz.createDiv({ cls: "ve-sc-cabecalho-colunas" });
	cabecalho.createDiv({ cls: "ve-sc-titulo-coluna", text: "Claro · :root" });
	cabecalho.createDiv({ cls: "ve-sc-titulo-coluna", text: "Escuro · .dark" });

	for (const bloco of BLOCOS) {
		desenharBloco(raiz, bloco, claro, escuro, acoes);
	}

	desenharBlocoRadius(raiz, claro, escuro, acoes);
}

function desenharBloco(
	raiz: HTMLElement,
	bloco: BlocoShadcn,
	claro: Map<string, Campo>,
	escuro: Map<string, Campo>,
	acoes: AcoesShadcn
): void {
	const secao = raiz.createDiv({ cls: "ve-sc-bloco" });
	secao.createDiv({ cls: "ve-sc-bloco-titulo", text: bloco.titulo });

	const linhas = secao.createDiv({ cls: "ve-sc-linhas" });
	for (const token of bloco.tokens) {
		desenharLinha(linhas, token.nome, claro.get(token.nome) ?? null, escuro.get(token.nome) ?? null, acoes);
	}
}

/**
 * Uma linha: nome técnico + ":" à esquerda de CADA coluna, e a barra de cor/campo ao lado — pedido
 * dela, "nome da variável mesmo, que vem antes dos dois-pontos" — sem humanizar, sem esconder atrás
 * de rótulo bonito. `--font-*` não é cor (é uma pilha de fontes/nome), então cai em campo de texto
 * simples; os demais tentam o par hex↔oklch primeiro.
 */
function desenharLinha(
	pai: HTMLElement,
	nomeToken: string,
	campoClaro: Campo | null,
	campoEscuro: Campo | null,
	acoes: AcoesShadcn
): void {
	const linha = pai.createDiv({ cls: "ve-sc-linha" });

	const ehFonte = nomeToken.startsWith("--font-");
	if (ehFonte) {
		desenharCampoTexto(linha, nomeToken, campoClaro, acoes);
		desenharCampoTexto(linha, nomeToken, campoEscuro, acoes);
	} else {
		desenharCampoCor(linha, nomeToken, campoClaro, acoes);
		desenharCampoCor(linha, nomeToken, campoEscuro, acoes);
	}
}

function desenharRotuloToken(pai: HTMLElement, nomeToken: string): void {
	pai.createSpan({ cls: "ve-sc-nome-token", text: `${nomeToken}:` });
}

/**
 * Um campo de texto simples: rótulo do token + valor, sem controle especial — usado por Fonte
 * (pilha de fontes, não é cor) e por `--radius` (medida em rem/px, não multiplicador). As duas
 * chamadas só diferem no texto do placeholder de "vazio".
 */
function desenharCampoTexto(
	pai: HTMLElement,
	nomeToken: string,
	campo: Campo | null,
	acoes: AcoesShadcn,
	placeholderVazio = "— não encontrado —"
): void {
	const caixa = pai.createDiv({ cls: "ve-sc-campo" });
	if (!campo) caixa.addClass("is-vazio");
	desenharRotuloToken(caixa, nomeToken);

	const entrada = caixa.createEl("input", {
		cls: "ve-sc-entrada-texto",
		attr: {
			type: "text",
			spellcheck: "false",
			value: campo?.valor ?? "",
			placeholder: campo ? "" : placeholderVazio,
			disabled: campo ? null : "true",
		},
	});
	if (!campo) return;

	const confirmar = () => {
		const valor = entrada.value.trim();
		if (!valor) return;
		acoes.aplicarToken(campo.chave, valor);
	};
	entrada.addEventListener("blur", confirmar);
	entrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entrada.blur();
	});
}

/**
 * O campo de cor: mostra e edita em HEX, sempre — o valor gravado no arquivo é oklch(). Se o campo
 * já tiver um valor que NÃO é oklch (ela pode ter digitado outra coisa), mostra como está, sem
 * forçar conversão. `foraDoGamut` acende um aviso pequeno quando o oklch original é mais saturado
 * do que hex/sRGB alcança — a amostra mostra a cor mais próxima possível, não a exata.
 */
function desenharCampoCor(pai: HTMLElement, nomeToken: string, campo: Campo | null, acoes: AcoesShadcn): void {
	const caixa = pai.createDiv({ cls: "ve-sc-campo" });
	if (!campo) caixa.addClass("is-vazio");
	desenharRotuloToken(caixa, nomeToken);

	if (!campo) {
		caixa.createSpan({ cls: "ve-sc-vazio-texto", text: "— não encontrado —" });
		return;
	}

	const oklch = lerOklch(campo.valor);
	const conversao = oklch ? oklchParaHex(oklch) : null;
	const hexInicial = conversao?.hex ?? (/^#[0-9a-f]{3,6}$/i.test(campo.valor.trim()) ? campo.valor.trim() : "#8a8da3");

	const swatch = caixa.createDiv({ cls: "ve-sc-swatch" });
	swatch.style.background = hexInicial;
	if (conversao?.foraDoGamut) {
		swatch.addClass("is-fora-do-gamut");
		swatch.setAttr("title", "Esta cor é mais saturada do que hex consegue representar — mostrando a mais próxima possível.");
	}
	const seletor = swatch.createEl("input", { attr: { type: "color", value: hexInicial } });

	const entradaHex = caixa.createEl("input", {
		cls: "ve-sc-entrada-hex",
		attr: { type: "text", spellcheck: "false", value: hexInicial },
	});

	const gravar = (hex: string) => {
		// Preserva o alfa original (se o oklch tinha canal alfa) — trocar só a cor não deveria zerar
		// a transparência que já estava lá.
		const novoOklch = hexParaOklch(hex, oklch?.alfa);
		acoes.aplicarToken(campo.chave, novoOklch ? escreverOklch(novoOklch) : hex);
	};

	seletor.addEventListener("input", () => {
		entradaHex.value = seletor.value;
		swatch.style.background = seletor.value;
	});
	seletor.addEventListener("change", () => gravar(seletor.value));

	const confirmarTexto = () => {
		const valor = entradaHex.value.trim();
		if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(valor)) return;
		swatch.style.background = valor;
		gravar(valor);
	};
	entradaHex.addEventListener("blur", confirmarTexto);
	entradaHex.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entradaHex.blur();
	});
}

/**
 * O raio: --radius em si (:root/.dark, valor real tipo "0.625rem") + os 6 multiplicadores que o
 * `@theme inline` calcula a partir dele — só o NÚMERO é editável em cada um (`0.6`, `1.4`…), o resto
 * da fórmula `calc(var(--radius) * X)` fica intacto. Cada multiplicador ganha um protótipo visual
 * do raio resultante, pedido dela: "pra eu ver como é que fica essa borda".
 */
function desenharBlocoRadius(
	raiz: HTMLElement,
	claro: Map<string, Campo>,
	escuro: Map<string, Campo>,
	acoes: AcoesShadcn
): void {
	const secao = raiz.createDiv({ cls: "ve-sc-bloco" });
	secao.createDiv({ cls: "ve-sc-bloco-titulo", text: "8. Radius" });

	const linhas = secao.createDiv({ cls: "ve-sc-linhas" });
	const linhaBase = linhas.createDiv({ cls: "ve-sc-linha" });
	desenharCampoTexto(linhaBase, "--radius", claro.get("--radius") ?? null, acoes);
	desenharCampoTexto(linhaBase, "--radius", escuro.get("--radius") ?? null, acoes);

	// --radius-lg é sempre var(--radius) sem multiplicador — não entra na grade de multiplicadores.
	const grade = secao.createDiv({ cls: "ve-sc-grade-multiplicadores" });
	for (const mult of MULTIPLICADORES_RAIO) {
		desenharMultiplicador(grade, mult.nome, mult.rotulo, claro.get(mult.nome) ?? null, claro.get("--radius")?.valor, acoes);
	}
}

/** Raio padrão do shadcn/ui quando `--radius` ainda não existe no arquivo — só para a prévia ter algo a mostrar. */
const RAIO_BASE_PADRAO = "0.625rem";

function desenharMultiplicador(
	pai: HTMLElement,
	nomeToken: string,
	rotulo: string,
	campo: Campo | null,
	valorRadioBase: string | undefined,
	acoes: AcoesShadcn
): void {
	const cartao = pai.createDiv({ cls: "ve-sc-multiplicador" });
	if (!campo) cartao.addClass("is-vazio");
	cartao.createDiv({ cls: "ve-sc-multiplicador-rotulo", text: rotulo });
	desenharRotuloToken(cartao, nomeToken);

	const preview = cartao.createDiv({ cls: "ve-sc-multiplicador-preview" });

	if (!campo) {
		cartao.createSpan({ cls: "ve-sc-vazio-texto", text: "— não encontrado —" });
		return;
	}

	const numeroAtual = lerMultiplicador(campo.valor);
	const aplicarPreview = (numero: number) => {
		preview.style.borderRadius = `calc(${valorRadioBase ?? RAIO_BASE_PADRAO} * ${numero})`;
	};
	if (numeroAtual !== null) aplicarPreview(numeroAtual);

	const entrada = cartao.createEl("input", {
		cls: "ve-sc-entrada-numero",
		attr: {
			type: "text",
			spellcheck: "false",
			value: numeroAtual !== null ? String(numeroAtual) : campo.valor,
		},
	});

	entrada.addEventListener("input", () => {
		const numero = parseFloat(entrada.value.trim());
		if (!Number.isNaN(numero)) aplicarPreview(numero);
	});

	const confirmar = () => {
		const numero = parseFloat(entrada.value.trim());
		if (Number.isNaN(numero)) return;
		acoes.aplicarToken(campo.chave, gravarMultiplicador(numero));
	};
	entrada.addEventListener("blur", confirmar);
	entrada.addEventListener("keydown", (evento) => {
		if (evento.key === "Enter") entrada.blur();
	});
}
