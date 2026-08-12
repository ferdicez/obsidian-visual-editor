/**
 * Lê e escreve `box-shadow` como CAMADAS editáveis.
 *
 * Uma sombra de verdade quase nunca é uma sombra só — a que motivou este módulo tem três, e como
 * campo de texto único ela era pior de editar do que o CSS cru: uma linha de 120 caracteres onde
 * mexer no desfoque da segunda camada exige contar vírgulas dentro de `rgba()`.
 *
 * A promessa central do plugin continua valendo aqui, e é o que decide o desenho deste arquivo:
 * a sombra só é reescrita quando ela mexe num controle, e a reescrita monta o valor a partir das
 * camadas lidas. Por isso `separarCamadas` NÃO pode inventar: o que não se encaixa na forma
 * `[inset] x y [desfoque] [espalhamento] [cor]` volta como camada "crua", que a interface mostra
 * como texto e devolve ao arquivo idêntica.
 */

import { ehCor } from "./deduzir";

export interface CamadaSombra {
	/** O texto original desta camada, para devolver intacta quando não foi editada. */
	original: string;
	/** Null quando a camada não pôde ser decomposta — a interface cai em campo de texto. */
	partes: PartesSombra | null;
}

export interface PartesSombra {
	interna: boolean;
	x: Medida;
	y: Medida;
	desfoque: Medida | null;
	espalhamento: Medida | null;
	cor: string | null;
}

export interface Medida {
	numero: number;
	/** `0` sozinho é válido em CSS e não tem unidade. Preservar isso evita reescrever `0` como `0px`. */
	unidade: string;
}

const UNIDADES = ["px", "rem", "em", "%", "vh", "vw", "ch", "pt", "cm", "mm", "in"];
const RE_MEDIDA = /^(-?\d*\.?\d+)([a-z%]*)$/i;

/**
 * Parte o valor nas vírgulas de TOPO — as que separam camadas.
 *
 * As vírgulas dentro de `rgba(0, 0, 0, .5)` não separam nada; cortar nelas transformaria uma
 * sombra em quatro camadas sem sentido. Por isso o corte conta parênteses em vez de usar `split`.
 */
export function separarCamadas(valor: string): CamadaSombra[] {
	const pedacos: string[] = [];
	let profundidade = 0;
	let atual = "";

	for (let i = 0; i < valor.length; i++) {
		const c = valor[i];

		if (c === "(") profundidade++;
		else if (c === ")") profundidade--;

		if (c === "," && profundidade === 0) {
			pedacos.push(atual);
			atual = "";
			continue;
		}

		atual += c;
	}
	pedacos.push(atual);

	return pedacos
		.map((pedaco) => pedaco.trim())
		.filter(Boolean)
		.map((original) => ({ original, partes: decompor(original) }));
}

/**
 * Decompõe UMA camada. Null quando a forma não é reconhecida.
 *
 * A ordem em CSS é posicional (`x y desfoque espalhamento`), com a cor e o `inset` podendo aparecer
 * em qualquer lugar. Então: tira `inset`, tira a cor, e o que sobrar tem de ser 2, 3 ou 4 medidas.
 * Qualquer outra contagem significa que não entendemos o valor — e não entender é motivo para
 * devolver null, nunca para chutar.
 */
function decompor(camada: string): PartesSombra | null {
	const fichas = fatiar(camada);
	if (fichas.length === 0) return null;

	let interna = false;
	let cor: string | null = null;
	const medidas: Medida[] = [];

	for (const ficha of fichas) {
		if (/^inset$/i.test(ficha)) {
			// Duas vezes `inset` não é CSS válido; melhor não fingir que entendemos.
			if (interna) return null;
			interna = true;
			continue;
		}

		const medida = lerMedida(ficha);
		if (medida) {
			medidas.push(medida);
			continue;
		}

		if (ehCor(ficha)) {
			if (cor !== null) return null;
			cor = ficha;
			continue;
		}

		// Sobrou algo que não é `inset`, nem medida, nem cor: `var(--sombra-base)`, `calc(...)`, uma
		// palavra-chave que não conhecemos. A camada inteira volta como texto.
		return null;
	}

	if (medidas.length < 2 || medidas.length > 4) return null;

	return {
		interna,
		x: medidas[0],
		y: medidas[1],
		desfoque: medidas[2] ?? null,
		espalhamento: medidas[3] ?? null,
		cor,
	};
}

/**
 * Quebra a camada em fichas por espaço, mantendo `rgba(0, 0, 0, .5)` inteiro.
 *
 * O espaço dentro dos parênteses é separador de argumento, não de ficha — o mesmo motivo pelo qual
 * `separarCamadas` conta profundidade.
 */
function fatiar(camada: string): string[] {
	const fichas: string[] = [];
	let profundidade = 0;
	let atual = "";

	for (let i = 0; i < camada.length; i++) {
		const c = camada[i];

		if (c === "(") profundidade++;
		else if (c === ")") profundidade--;

		if (/\s/.test(c) && profundidade === 0) {
			if (atual) fichas.push(atual);
			atual = "";
			continue;
		}

		atual += c;
	}
	if (atual) fichas.push(atual);

	return fichas;
}

function lerMedida(ficha: string): Medida | null {
	const m = ficha.match(RE_MEDIDA);
	if (!m) return null;

	const numero = parseFloat(m[1]);
	if (Number.isNaN(numero)) return null;

	const unidade = m[2].toLowerCase();
	// Sem unidade só vale para zero — `2` sozinho não é uma distância CSS válida.
	if (!unidade) return numero === 0 ? { numero, unidade: "" } : null;
	if (!UNIDADES.includes(unidade)) return null;

	return { numero, unidade };
}

/** Monta a medida de volta em texto. `0` sem unidade continua `0`. */
export function medidaParaTexto(medida: Medida): string {
	return `${arredondar(medida.numero)}${medida.unidade}`;
}

/**
 * Arredonda o que a aritmética de ponto flutuante sujou.
 *
 * Sem isto, arrastar um slider de `rem` grava `0.30000000000000004rem` no arquivo dela.
 */
function arredondar(numero: number): number {
	return Math.round(numero * 1000) / 1000;
}

/** Monta UMA camada em texto, na ordem canônica do CSS. */
export function camadaParaTexto(camada: CamadaSombra): string {
	if (!camada.partes) return camada.original;

	const { interna, x, y, desfoque, espalhamento, cor } = camada.partes;
	const pedacos: string[] = [];

	if (interna) pedacos.push("inset");
	pedacos.push(medidaParaTexto(x), medidaParaTexto(y));

	// O espalhamento é posicional: só pode ser escrito depois do desfoque. Quando há espalhamento
	// mas o desfoque veio ausente, `0` é o valor que o CSS assume — escrevê-lo explicitamente é o
	// que mantém o espalhamento no lugar certo.
	if (desfoque) pedacos.push(medidaParaTexto(desfoque));
	else if (espalhamento) pedacos.push("0");

	if (espalhamento) pedacos.push(medidaParaTexto(espalhamento));
	if (cor) pedacos.push(cor);

	return pedacos.join(" ");
}

/**
 * Monta a sombra inteira.
 *
 * Junta com `, ` — a formatação original de cada camada é preservada nas camadas cruas, mas o
 * espaçamento ENTRE camadas é normalizado. É a única liberdade que este módulo toma com o arquivo,
 * e só acontece quando ela edita a sombra (uma sombra não tocada nunca passa por aqui).
 */
export function sombraParaTexto(camadas: CamadaSombra[]): string {
	return camadas.map(camadaParaTexto).join(", ");
}

/** Uma camada nova, para o botão de adicionar. Valores discretos: ela ajusta a partir daí. */
export function camadaPadrao(): CamadaSombra {
	return {
		original: "0 2px 4px rgba(0, 0, 0, 0.1)",
		partes: {
			interna: false,
			x: { numero: 0, unidade: "" },
			y: { numero: 2, unidade: "px" },
			desfoque: { numero: 4, unidade: "px" },
			espalhamento: null,
			cor: "rgba(0, 0, 0, 0.1)",
		},
	};
}
