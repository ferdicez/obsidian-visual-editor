/**
 * Gera a escala de tons de "Cores principais" a partir da cor que ela digita — 2 mais escuros e 2
 * mais claros, variando só a LUMINOSIDADE em HSL (mesmo matiz e saturação da cor base), com ajuste
 * fino de saturação/luminosidade por tom guardado como token à parte.
 *
 * Pedido dela: *"eu queria que eu colocasse uma cor, um código, e aí automaticamente ele gerasse
 * duas tonalidades dessa mesma cor mais escura e duas tonalidades dessa mesma cor mais clara"* — e
 * poder ajustar saturação/luminosidade de cada tom depois, com o ajuste persistindo no arquivo.
 */

export interface HSL {
	h: number; // 0-360
	s: number; // 0-100
	l: number; // 0-100
}

/** Os 4 tons ao redor do tom-base (índice 2), do mais escuro ao mais claro — a ordem de exibição. */
export const PASSOS_LUMINOSIDADE = [-30, -15, 0, 15, 30];

export function hexParaHsl(hex: string): HSL | null {
	const m = hex.trim().match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
	if (!m) return null;

	let valor = m[1];
	if (valor.length === 3) {
		valor = valor.split("").map((c) => c + c).join("");
	}

	const r = parseInt(valor.slice(0, 2), 16) / 255;
	const g = parseInt(valor.slice(2, 4), 16) / 255;
	const b = parseInt(valor.slice(4, 6), 16) / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;

	let h = 0;
	if (delta !== 0) {
		if (max === r) h = ((g - b) / delta) % 6;
		else if (max === g) h = (b - r) / delta + 2;
		else h = (r - g) / delta + 4;
		h *= 60;
		if (h < 0) h += 360;
	}

	const l = (max + min) / 2;
	const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

	return { h, s: s * 100, l: l * 100 };
}

export function hslParaHex(hsl: HSL): string {
	const h = ((hsl.h % 360) + 360) % 360;
	const s = Math.max(0, Math.min(100, hsl.s)) / 100;
	const l = Math.max(0, Math.min(100, hsl.l)) / 100;

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let [r, g, b] = [0, 0, 0];
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];

	const canal = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
	return `#${canal(r)}${canal(g)}${canal(b)}`;
}

/**
 * Um tom calculado da escala: a luminosidade base (cor + passo) com o ajuste fino da usuária somado
 * por cima. `ajuste` é sempre relativo ao tom calculado, nunca ao tom anterior — reabrir o popover
 * e ajustar de novo não acumula erro.
 */
export interface AjusteTom {
	sat: number; // graus percentuais, soma à saturação do tom calculado
	lum: number; // idem, à luminosidade
}

export function tomCalculado(base: HSL, passoLuminosidade: number, ajuste: AjusteTom | null): string {
	const hsl: HSL = {
		h: base.h,
		s: base.s + (ajuste?.sat ?? 0),
		l: base.l + passoLuminosidade + (ajuste?.lum ?? 0),
	};
	return hslParaHex(hsl);
}

/** `"−10%"` / `"5%"` → -10 / 5. Aceita tanto o hífen comum quanto o menos tipográfico. */
export function percentualParaNumero(valor: string | undefined): number {
	if (!valor) return 0;
	const limpo = valor.trim().replace("−", "-").replace("%", "");
	const numero = parseFloat(limpo);
	return Number.isNaN(numero) ? 0 : numero;
}

export function numeroParaPercentual(numero: number): string {
	const arredondado = Math.round(numero * 10) / 10;
	return `${arredondado}%`;
}
