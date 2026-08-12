/**
 * Lê e escreve valores de LADOS — `padding`, `margin`, `gap`, `inset`, `border-width`.
 *
 * O CSS abrevia por posição: um valor vale para os quatro lados, dois viram vertical/horizontal,
 * três viram cima/lados/baixo, quatro são cima/direita/baixo/esquerda no sentido horário. Até aqui o
 * plugin só entendia a forma de UM valor (que virava slider); `padding: 8px 16px` caía em campo de
 * texto, e é justamente a forma mais comum.
 *
 * A regra que este módulo segue, a mesma do resto do plugin: **a forma abreviada é preservada**. Um
 * `padding: 16px` que ela não mexeu volta `16px`, não `16px 16px 16px 16px`. Expandir sem ela pedir
 * encheria o diff de mudanças que ela não fez.
 */

const UNIDADES = ["px", "rem", "em", "%", "vh", "vw", "ch", "pt", "cm", "mm", "in"];
const RE_MEDIDA = /^(-?\d*\.?\d+)([a-z%]*)$/i;

/** As propriedades que aceitam a forma de lados. `gap` só aceita dois; o resto, até quatro. */
const PROPRIEDADES = new Set([
	"padding",
	"margin",
	"inset",
	"border-width",
	"border-radius",
	"scroll-padding",
	"scroll-margin",
	"gap",
	"grid-gap",
]);

export interface Lado {
	/** O texto original deste lado — `16px`, `auto`, `var(--x)`. */
	bruto: string;
	/** Número e unidade quando o lado é uma medida; null para `auto`, `var()`, etc. */
	medida: { numero: number; unidade: string } | null;
}

export interface ValorLados {
	/** Sempre quatro: cima, direita, baixo, esquerda — já expandidos a partir da abreviação. */
	lados: [Lado, Lado, Lado, Lado];
	/** Quantos valores o arquivo escreveu (1 a 4). É o que permite devolver na mesma forma. */
	escritos: number;
}

export const NOMES_LADOS = ["Cima", "Direita", "Baixo", "Esquerda"] as const;

/** A propriedade aceita a forma de lados? */
export function ehPropriedadeDeLados(propriedade: string): boolean {
	return PROPRIEDADES.has(propriedade.toLowerCase());
}

/**
 * Lê `8px 16px` como os quatro lados.
 *
 * Devolve null quando não é uma lista de lados válida — um valor único (que já tem slider próprio),
 * mais de quatro partes, ou algo que não se parece com medida em nenhum dos lados. Null faz a
 * interface cair no campo de texto, que nunca estraga o arquivo.
 */
export function lerLados(valor: string): ValorLados | null {
	const partes = fatiar(valor.trim());

	// Um valor só continua com o slider simples: um controle de quatro lados para `padding: 16px`
	// seria mais trabalho para o mesmo resultado.
	if (partes.length < 2 || partes.length > 4) return null;

	const lados = partes.map((bruto) => ({ bruto, medida: lerMedida(bruto) }));

	// Cada lado tem de ser algo que caiba num lado: uma medida, `auto`, ou uma referência.
	//
	// `var(--espaco-lg) var(--espaco-md)` é a forma mais comum num CSS com design tokens, e exigir um
	// lado numérico a deixaria de fora — justamente o arquivo que este plugin existe para editar. Os
	// lados de referência aparecem como texto no controle e voltam intactos; o ganho é ela poder
	// mexer no lado numérico ao lado deles, e ver os quatro lados separados.
	const cabeEmLado = (bruto: string) =>
		lerMedida(bruto) !== null || /^(auto|inherit|initial|unset|revert)$/i.test(bruto) || /^(var|calc|min|max|clamp)\s*\(/i.test(bruto);

	if (!lados.every((lado) => cabeEmLado(lado.bruto))) return null;

	return { lados: expandir(lados), escritos: partes.length };
}

/**
 * A expansão posicional do CSS.
 *
 *   2 valores → cima/baixo, direita/esquerda
 *   3 valores → cima, direita/esquerda, baixo
 *   4 valores → cima, direita, baixo, esquerda
 */
function expandir(lados: Lado[]): [Lado, Lado, Lado, Lado] {
	const [a, b, c, d] = lados;
	switch (lados.length) {
		case 2:
			return [a, b, a, b];
		case 3:
			return [a, b, c, b];
		default:
			return [a, b, c, d];
	}
}

/**
 * Remonta, na forma mais curta que ainda diga a mesma coisa.
 *
 * `escritos` é o piso, não o teto: um `padding: 8px 16px` que ela não desequilibrou volta com dois
 * valores mesmo que os quatro lados sejam conhecidos. Mas se ela mexer só no lado direito, a forma
 * cresce para caber a diferença — encurtar à força mudaria o resultado na tela.
 */
export function escreverLados(valor: ValorLados): string {
	const [cima, direita, baixo, esquerda] = valor.lados.map((lado) => lado.bruto);

	// A forma mais curta que ainda descreve estes quatro lados...
	let minima: number;
	if (cima === direita && direita === baixo && baixo === esquerda) minima = 1;
	else if (cima === baixo && direita === esquerda) minima = 2;
	else if (direita === esquerda) minima = 3;
	else minima = 4;

	// ...mas nunca mais curta do que o arquivo já tinha.
	//
	// Sem este piso, um `padding: 8px 8px` que ela nem tocou seria reescrito como `8px` ao editar
	// outra coisa da mesma regra. O resultado na tela é o mesmo, mas é uma mudança que ela não pediu
	// — e "não reescrever o que ela não mexeu" é a promessa que sustenta o plugin inteiro.
	const quantos = Math.max(minima, valor.escritos);
	return [cima, direita, baixo, esquerda].slice(0, quantos).join(" ");
}

/**
 * Troca UM lado, respeitando o espelhamento da forma abreviada.
 *
 * Numa forma de dois valores, direita e esquerda são o MESMO valor escrito: mexer só na direita e
 * deixar a esquerda como estava produziria `8px 20px 8px 16px` — quatro valores onde ela mudou um,
 * e a esquerda mudando sozinha de 16px para... 16px, mas agora explícito. O espelho mantém a forma
 * curta enquanto ela estiver ajustando "os dois lados de uma vez", e a quebra só quando ela mexe num
 * lado que a forma atual não distingue.
 *
 * `separar` desliga o espelho: é o botão de "editar cada lado" da interface.
 */
export function trocarLado(
	valor: ValorLados,
	indice: number,
	novo: Lado,
	separar: boolean
): ValorLados {
	const lados = [...valor.lados] as [Lado, Lado, Lado, Lado];
	lados[indice] = novo;

	if (!separar) {
		// Forma de 1: os quatro andam juntos. Forma de 2 ou 3: cima/baixo e direita/esquerda.
		if (valor.escritos === 1) {
			lados[0] = novo;
			lados[1] = novo;
			lados[2] = novo;
			lados[3] = novo;
		} else if (valor.escritos === 2) {
			if (indice === 0 || indice === 2) {
				lados[0] = novo;
				lados[2] = novo;
			} else {
				lados[1] = novo;
				lados[3] = novo;
			}
		} else if (valor.escritos === 3 && (indice === 1 || indice === 3)) {
			lados[1] = novo;
			lados[3] = novo;
		}
	}

	return { lados, escritos: valor.escritos };
}

/** Monta o texto de um lado a partir de número e unidade. */
export function ladoDeMedida(numero: number, unidade: string): string {
	const limpo = Math.round(numero * 1000) / 1000;
	// Zero dispensa unidade em CSS, e é como se escreve na prática.
	if (limpo === 0) return "0";
	return `${limpo}${unidade || "px"}`;
}

/** Quebra por espaços, mantendo `var(--x)` e `calc(1px + 2px)` inteiros. */
function fatiar(valor: string): string[] {
	const partes: string[] = [];
	let profundidade = 0;
	let atual = "";

	for (const c of valor) {
		if (c === "(") profundidade++;
		else if (c === ")") profundidade--;

		if (/\s/.test(c) && profundidade === 0) {
			if (atual) partes.push(atual);
			atual = "";
			continue;
		}
		atual += c;
	}
	if (atual) partes.push(atual);

	return partes;
}

function lerMedida(ficha: string): { numero: number; unidade: string } | null {
	const m = ficha.match(RE_MEDIDA);
	if (!m) return null;

	const numero = parseFloat(m[1]);
	if (Number.isNaN(numero)) return null;

	const unidade = m[2].toLowerCase();
	if (!unidade) return numero === 0 ? { numero: 0, unidade: "" } : null;
	if (!UNIDADES.includes(unidade)) return null;

	return { numero, unidade };
}
