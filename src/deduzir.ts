import { ehPropriedadeDeLados, lerLados } from "./lados";
import { TipoCampo } from "./tipos";

/**
 * Deduz QUE CONTROLE desenhar a partir do valor que está no arquivo.
 *
 * A usuária não anota nada: ela escreve CSS/JSON normal e o plugin descobre. `#e63946` é
 * evidentemente uma cor, `16px` é evidentemente uma medida. Onde a evidência acaba, o campo cai em
 * "texto" — um campo de digitação livre é sempre correto, só é menos confortável. Errar para o
 * lado do texto livre nunca estraga o arquivo; errar para o lado do slider, sim.
 */

// `inherit`, `initial` e `unset` NÃO entram aqui: valem para qualquer propriedade, e tratá-los como
// cor fazia `padding: inherit` abrir um seletor de cor. São palavras-chave globais, não cores.
const CORES_NOMEADAS = new Set([
	"transparent", "currentcolor",
	"black", "white", "red", "green", "blue", "yellow", "orange", "purple", "pink", "brown",
	"gray", "grey", "silver", "gold", "cyan", "magenta", "lime", "navy", "teal", "olive",
	"maroon", "aqua", "fuchsia", "indigo", "violet", "coral", "salmon", "khaki", "beige",
	"ivory", "lavender", "plum", "orchid", "tan", "turquoise", "crimson", "tomato",
]);

/** Unidades que fazem sentido num slider. `fr`, `vh`, `vw` entram; `s`/`ms` são tempo, não medida visual. */
const UNIDADES_MEDIDA = ["px", "rem", "em", "%", "vh", "vw", "vmin", "vmax", "ch", "ex", "pt", "cm", "mm", "in", "fr"];

/** Faixas do slider por unidade. Cobrem o uso comum sem travar: o campo numérico aceita fora da faixa. */
const FAIXAS: Record<string, { minimo: number; maximo: number; passo: number }> = {
	px: { minimo: 0, maximo: 200, passo: 1 },
	rem: { minimo: 0, maximo: 12, passo: 0.05 },
	em: { minimo: 0, maximo: 12, passo: 0.05 },
	"%": { minimo: 0, maximo: 100, passo: 1 },
	vh: { minimo: 0, maximo: 100, passo: 1 },
	vw: { minimo: 0, maximo: 100, passo: 1 },
	vmin: { minimo: 0, maximo: 100, passo: 1 },
	vmax: { minimo: 0, maximo: 100, passo: 1 },
	ch: { minimo: 0, maximo: 80, passo: 0.5 },
	ex: { minimo: 0, maximo: 80, passo: 0.5 },
	pt: { minimo: 0, maximo: 150, passo: 1 },
	cm: { minimo: 0, maximo: 50, passo: 0.1 },
	mm: { minimo: 0, maximo: 500, passo: 1 },
	in: { minimo: 0, maximo: 20, passo: 0.1 },
	fr: { minimo: 0, maximo: 12, passo: 1 },
};

export interface Deducao {
	tipo: TipoCampo;
	unidade?: string;
	minimo?: number;
	maximo?: number;
	passo?: number;
	opcoes?: string[];
}

/** `#fff`, `#ffffff`, `#ffffffcc` — 3, 4, 6 ou 8 dígitos hexadecimais. */
const RE_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RE_FUNCAO_COR = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const RE_MEDIDA = /^(-?\d*\.?\d+)\s*([a-z%]+)$/i;
const RE_NUMERO = /^-?\d*\.?\d+$/;

export function ehCor(valor: string): boolean {
	const v = valor.trim().toLowerCase();
	return RE_HEX.test(v) || RE_FUNCAO_COR.test(v) || CORES_NOMEADAS.has(v);
}

/**
 * Converte qualquer cor CSS para o `#rrggbb` que o `<input type="color">` exige — ele não aceita
 * `rgb()`, nem nome, nem alfa. Devolve null quando não dá para converter com segurança; nesse caso
 * a interface mostra o campo de texto em vez de um seletor que mentiria sobre a cor real.
 *
 * O canal alfa é DESCARTADO de propósito na amostra: o input não o representa, e fingir que
 * `#ffffffcc` é branco opaco seria menos honesto do que só não oferecer o seletor. Por isso o alfa
 * também bloqueia o seletor (ver `corTemAlfa`).
 */
export function paraHex(valor: string, doc: Document): string | null {
	const v = valor.trim();

	if (RE_HEX.test(v)) {
		// #abc → #aabbcc. O input só entende a forma longa.
		if (v.length === 4) {
			return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
		}
		if (v.length === 7) return v.toLowerCase();
		// 4 ou 8 dígitos: tem alfa, tratado fora daqui.
		return null;
	}

	// Para nomes e funções, o próprio navegador é o conversor mais confiável que existe: joga no
	// style de um elemento solto e lê de volta o `rgb()` normalizado. Nada de tabela de nomes.
	const sonda = doc.createElement("span");
	sonda.style.color = "";
	sonda.style.color = v;
	if (!sonda.style.color) return null;

	doc.body.appendChild(sonda);
	const calculado = doc.defaultView?.getComputedStyle(sonda).color ?? "";
	sonda.remove();

	const canais = calculado.match(/^rgba?\(([^)]+)\)$/i);
	if (!canais) return null;

	const partes = canais[1].split(/[,\s/]+/).filter(Boolean);
	if (partes.length < 3) return null;

	const [r, g, b] = partes.slice(0, 3).map((n) => {
		const numero = n.endsWith("%") ? (parseFloat(n) / 100) * 255 : parseFloat(n);
		return Math.max(0, Math.min(255, Math.round(numero)));
	});

	if ([r, g, b].some((n) => Number.isNaN(n))) return null;

	const hex = (n: number) => n.toString(16).padStart(2, "0");
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * A cor tem transparência? Se tiver, o seletor nativo não serve — ele devolveria opaco e comeria o
 * alfa que ela escreveu. Melhor mostrar campo de texto e preservar o valor dela.
 */
export function corTemAlfa(valor: string): boolean {
	const v = valor.trim().toLowerCase();
	if (RE_HEX.test(v) && (v.length === 5 || v.length === 9)) return true;
	if (/^(?:rgba|hsla)\s*\(/.test(v)) return true;
	// `rgb(0 0 0 / 50%)` — sintaxe moderna com barra.
	if (RE_FUNCAO_COR.test(v) && v.includes("/")) return true;
	return v === "transparent";
}

/** Separa `1.5rem` em número e unidade. Null se não for uma medida simples. */
export function partirMedida(valor: string): { numero: number; unidade: string } | null {
	const m = valor.trim().match(RE_MEDIDA);
	if (!m) return null;

	const numero = parseFloat(m[1]);
	const unidade = m[2].toLowerCase();
	if (Number.isNaN(numero)) return null;
	if (!UNIDADES_MEDIDA.includes(unidade)) return null;

	return { numero, unidade };
}

/**
 * Faixa do slider. Quando o valor já passa do teto da tabela (um `max-width: 1200px`), o teto sobe
 * para acomodá-lo — um slider que nasce colado na ponta direita não deixa aumentar nada.
 */
function faixaPara(unidade: string, numero: number): { minimo: number; maximo: number; passo: number } {
	const base = FAIXAS[unidade] ?? { minimo: 0, maximo: 100, passo: 1 };
	if (numero <= base.maximo && numero >= base.minimo) return base;

	const maximo = numero > base.maximo ? Math.ceil((numero * 1.5) / 10) * 10 : base.maximo;
	const minimo = numero < base.minimo ? Math.floor(numero) : base.minimo;
	return { minimo, maximo, passo: base.passo };
}

/** Um valor com mais de uma parte e uma cor no meio: `0 2px 8px rgba(0,0,0,.1)`. */
function ehSombra(valor: string): boolean {
	const v = valor.trim();
	if (!/\s/.test(v)) return false;
	return ehCor(v.split(/\s+(?![^(]*\))/).pop() ?? "") || /rgba?\(|hsla?\(/i.test(v);
}

/** `'Inter', -apple-system, sans-serif` — lista de fontes separada por vírgula. */
function ehPilhaDeFontes(chave: string, valor: string): boolean {
	if (!/fonte|font|family|tipografia|typeface/i.test(chave)) return false;
	return valor.includes(",") || /serif|sans|monospace|cursive|system-ui/i.test(valor);
}

/**
 * A dedução em si, na ordem em que as evidências são mais fortes: cor → medida → número puro →
 * fonte → sombra → texto. Ordem importa: `0` é número, mas `0px` é medida, e a regra de medida vem
 * antes justamente para pegar a unidade.
 */
export function deduzir(chave: string, valor: string): Deducao {
	const v = valor.trim();

	if (!v) return { tipo: "texto" };

	// Um valor que é APENAS uma referência não é editável como cor/medida — é um ponteiro. Editar
	// como texto preserva a referência; oferecer um seletor de cor a transformaria num hex fixo e
	// quebraria silenciosamente o encadeamento que ela montou.
	//
	// A checagem é do valor inteiro, não do começo: `padding: var(--sm) 16px` tem uma referência e um
	// número, e ancorar no começo fazia esse virar texto enquanto `padding: 16px var(--sm)` virava
	// controle — a mesma propriedade se comportando diferente conforme a ordem dos lados.
	if (/^var\s*\([^)]*\)$/i.test(v)) return { tipo: "texto" };

	// Duas ou mais referências numa propriedade de lados (`padding: var(--lg) var(--md)`) é a forma
	// mais comum num CSS com design tokens: vai para o controle de lados, onde cada referência
	// aparece como texto e volta intacta.
	if (ehPropriedadeDeLados(chave) && lerLados(v)) return { tipo: "lados" };

	// `calc()` idem: o resultado depende de contexto que o plugin não tem.
	if (/^calc\s*\(/i.test(v)) return { tipo: "texto" };

	if (ehCor(v)) return { tipo: "cor" };

	// Uma referência no meio de um valor composto que NÃO é lados continua texto.
	if (/\bvar\s*\(/i.test(v) && !ehPropriedadeDeLados(chave)) return { tipo: "texto" };

	const medida = partirMedida(v);
	if (medida) {
		return { tipo: "medida", unidade: medida.unidade, ...faixaPara(medida.unidade, medida.numero) };
	}

	if (RE_NUMERO.test(v)) {
		const numero = parseFloat(v);
		// Sem unidade não dá para saber a escala. Opacidade e line-height vivem em 0–2; um z-index,
		// não. O nome da chave é a única pista disponível.
		if (/opacidade|opacity|alpha/i.test(chave)) {
			return { tipo: "numero", minimo: 0, maximo: 1, passo: 0.01 };
		}
		if (/line-?height|altura-?linha|entrelinha/i.test(chave)) {
			return { tipo: "numero", minimo: 0.8, maximo: 3, passo: 0.05 };
		}
		if (/peso|weight/i.test(chave)) {
			return { tipo: "numero", minimo: 100, maximo: 900, passo: 100 };
		}
		const maximo = numero > 100 ? Math.ceil((numero * 1.5) / 10) * 10 : 100;
		return { tipo: "numero", minimo: Math.min(0, numero), maximo, passo: 1 };
	}

	if (v === "true" || v === "false") return { tipo: "booleano" };

	if (ehPilhaDeFontes(chave, v)) return { tipo: "fonte" };

	if (ehSombra(v)) return { tipo: "sombra" };

	// Textos com quebra de linha precisam de textarea; um input de uma linha esconderia o conteúdo.
	if (v.includes("\n") || v.length > 120) return { tipo: "textoLongo" };

	return { tipo: "texto" };
}
