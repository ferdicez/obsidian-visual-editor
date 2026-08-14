/**
 * Conversão hex ↔ oklch(), para a aba shadcn/Tailwind: o arquivo grava cor em `oklch()` (é o que o
 * gerador shadcn/ui produz), mas ela quer editar em HEX — escolher no seletor nativo do sistema,
 * copiar/colar em hex — sem nunca ver o número oklch na tela. O arquivo continua salvando oklch;
 * a conversão acontece nos dois sentidos, só na hora de mostrar e de gravar.
 *
 * Fórmulas padrão do CSS Color Module 4 (OKLab ↔ linear sRGB via as matrizes conhecidas). oklch é
 * um espaço de cor MAIOR que sRGB: uma cor bem saturada pode não caber em hex sem distorcer — nesse
 * caso o valor é recortado (clamped) para o mais próximo representável, e `foraDoGamut` avisa disso
 * para a interface sinalizar visualmente, em vez de fingir que a cor bate exatamente.
 */

const RE_OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i;

export interface Oklch {
	l: number; // 0–1 (luminosidade percebida)
	c: number; // 0+ (chroma — quão saturada)
	h: number; // 0–360 (matiz, em graus)
	alfa?: number; // 0–1, ausente quando o valor original não tinha canal alfa
}

export function lerOklch(valor: string): Oklch | null {
	const m = valor.trim().match(RE_OKLCH);
	if (!m) return null;
	const alfaTexto = m[4];
	const alfa = alfaTexto ? (alfaTexto.endsWith("%") ? parseFloat(alfaTexto) / 100 : parseFloat(alfaTexto)) : undefined;
	return { l: parseFloat(m[1]), c: parseFloat(m[2]), h: parseFloat(m[3]), alfa };
}

export function escreverOklch(o: Oklch): string {
	const l = arred(o.l, 3);
	const c = arred(o.c, 3);
	const h = arred(o.h, 3);
	const base = `oklch(${l} ${c} ${h}`;
	return o.alfa !== undefined ? `${base} / ${arred(o.alfa, 3)})` : `${base})`;
}

function arred(n: number, casas: number): number {
	const f = 10 ** casas;
	return Math.round(n * f) / f;
}

/** oklch → hex, com sinalização de fora-do-gamut sRGB (a cor foi recortada para caber em hex). */
export function oklchParaHex(o: Oklch): { hex: string; foraDoGamut: boolean } {
	const [r, g, b] = oklabParaSrgbLinear(oklchParaOklab(o));
	const [rs, gs, bs] = [r, g, b].map(linearParaSrgb);

	const foraDoGamut = [rs, gs, bs].some((v) => v < -1e-4 || v > 1 + 1e-4);

	const canal = (v: number) => {
		const clampado = Math.max(0, Math.min(1, v));
		return Math.round(clampado * 255)
			.toString(16)
			.padStart(2, "0");
	};

	return { hex: `#${canal(rs)}${canal(gs)}${canal(bs)}`, foraDoGamut };
}

/** hex → oklch. `alfaOriginal`/`hOriginalSeAcromatico` preservam metadados que hex sozinho não tem. */
export function hexParaOklch(hex: string, alfaOriginal?: number): Oklch | null {
	const m = hex.trim().match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
	if (!m) return null;
	let v = m[1];
	if (v.length === 3) v = v.split("").map((c) => c + c).join("");

	const rs = parseInt(v.slice(0, 2), 16) / 255;
	const gs = parseInt(v.slice(2, 4), 16) / 255;
	const bs = parseInt(v.slice(4, 6), 16) / 255;

	const [r, g, b] = [rs, gs, bs].map(srgbParaLinear);
	const [l, a2, bb] = srgbLinearParaOklab([r, g, b]);
	const oklab = { l, a: a2, b: bb };

	const c = Math.sqrt(oklab.a * oklab.a + oklab.b * oklab.b);
	let h = (Math.atan2(oklab.b, oklab.a) * 180) / Math.PI;
	if (h < 0) h += 360;

	return { l: oklab.l, c, h, alfa: alfaOriginal };
}

// --- Matemática OKLab ↔ sRGB (CSS Color Module 4) --------------------------------------------

function srgbParaLinear(v: number): number {
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearParaSrgb(v: number): number {
	return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function oklchParaOklab(o: Oklch): { l: number; a: number; b: number } {
	const hRad = (o.h * Math.PI) / 180;
	return { l: o.l, a: o.c * Math.cos(hRad), b: o.c * Math.sin(hRad) };
}

/** OKLab → linear sRGB, via LMS (matrizes padrão do CSS Color 4). */
function oklabParaSrgbLinear(lab: { l: number; a: number; b: number }): [number, number, number] {
	const l_ = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
	const m_ = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
	const s_ = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b;

	const l = l_ ** 3;
	const m = m_ ** 3;
	const s = s_ ** 3;

	const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	return [r, g, b];
}

/** Linear sRGB → OKLab. */
function srgbLinearParaOklab([r, g, b]: [number, number, number]): [number, number, number] {
	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);

	return [
		0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
		1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
		0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
	];
}
