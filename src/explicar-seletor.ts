/**
 * Traduz um seletor CSS para português — "quando esta regra vale".
 *
 * O pedido dela foi *"informar em quais páginas ele aparece"*, e isso o CSS não sabe: um arquivo de
 * estilos não guarda em que tela cada regra é usada. `.controle` pode estar em todas as páginas ou
 * em nenhuma, e só o HTML diria.
 *
 * O que o seletor sabe é a CONDIÇÃO: em que estado, em que largura de tela, dentro de qual camada
 * aquele estilo passa a valer. É isso que este módulo explica — e na prática responde à pergunta
 * dela por outro caminho, porque `@media (width >= 48rem) › .controle-quadrado` só vale em telas
 * largas, e `:focus-visible` só quando o elemento está em foco pelo teclado.
 *
 * A tradução é do que é RECONHECIDO. O que não se encaixa nos padrões conhecidos volta como está —
 * mostrar o seletor cru é sempre correto, inventar uma explicação errada não.
 */

export interface ParteExplicada {
	/** O trecho do seletor, como está no arquivo. */
	cru: string;
	/** A tradução, ou null quando não reconhecemos o padrão. */
	explicacao: string | null;
}

/** Pseudo-classes de ESTADO — as que dependem do que a usuária faz na tela. */
const ESTADOS: Array<[RegExp, string]> = [
	[/^:hover$/, "o ponteiro está sobre o elemento"],
	[/^:focus$/, "o elemento está em foco"],
	[/^:focus-visible$/, "o elemento está em foco pelo teclado"],
	[/^:focus-within$/, "algo dentro dele está em foco"],
	[/^:active$/, "o elemento está sendo clicado"],
	[/^:disabled$/, "o elemento está desabilitado"],
	[/^:checked$/, "está marcado"],
	[/^:first-child$/, "é o primeiro da lista"],
	[/^:last-child$/, "é o último da lista"],
	[/^:only-child$/, "é o único da lista"],
	[/^:empty$/, "está vazio"],
	[/^::before$/, "um pedaço criado ANTES do conteúdo"],
	[/^::after$/, "um pedaço criado DEPOIS do conteúdo"],
	[/^::placeholder$/, "o texto de exemplo do campo"],
	[/^::selection$/, "o trecho selecionado com o mouse"],
	[/^:root$/, "a raiz do documento (onde moram os tokens)"],
];

/**
 * Explica um nível do caminho (`@media …`, `@layer …`, ou um seletor de elemento).
 *
 * Os níveis chegam separados por ` › `, que é como o leitor de CSS monta o contexto.
 */
export function explicarSeletor(seletor: string): ParteExplicada[] {
	return seletor
		.split("›")
		.map((parte) => parte.trim())
		.filter(Boolean)
		.map((cru) => ({ cru, explicacao: explicarParte(cru) }));
}

function explicarParte(parte: string): string | null {
	// --- @media ------------------------------------------------------------------------------
	const media = parte.match(/^@media\s*(.+)$/i);
	if (media) return explicarMedia(media[1]);

	// --- @layer, @supports e afins -------------------------------------------------------------
	const layer = parte.match(/^@layer\s+(.+)$/i);
	if (layer) return `faz parte da camada "${layer[1].trim()}"`;

	const supports = parte.match(/^@supports\s*\((.+)\)$/i);
	if (supports) return `só se o navegador suportar ${supports[1].trim()}`;

	if (/^@container/i.test(parte)) return "depende do tamanho do container em volta, não da tela";
	if (/^@print/i.test(parte) || /^@media\s+print/i.test(parte)) return "só na impressão";

	// --- Lista de alvos ------------------------------------------------------------------------
	// `button, [role="button"], summary` — vale para vários elementos ao mesmo tempo.
	const alvos = dividirTopo(parte);
	if (alvos.length > 1) {
		return `vale para ${alvos.length} tipos de elemento ao mesmo tempo`;
	}

	return explicarAlvo(parte);
}

/** `(width >= 48rem)`, `(max-width: 640px)` → "a tela tem 768px ou mais". Null se não reconhecer. */
function explicarMedia(condicao: string): string | null {
	const limpa = condicao.trim().replace(/^\(|\)$/g, "").trim();

	// Sintaxe moderna: `width >= 48rem`
	const moderna = limpa.match(/^width\s*(>=|<=|>|<)\s*([\d.]+)(px|rem|em)$/i);
	if (moderna) {
		const [, comparador, numero, unidade] = moderna;
		const px = emPixels(parseFloat(numero), unidade);
		const maior = comparador.startsWith(">");
		return `a tela tem ${px} ou ${maior ? "mais" : "menos"}`;
	}

	// Sintaxe clássica: `min-width: 768px`
	const classica = limpa.match(/^(min|max)-width:\s*([\d.]+)(px|rem|em)$/i);
	if (classica) {
		const [, tipo, numero, unidade] = classica;
		const px = emPixels(parseFloat(numero), unidade);
		return tipo.toLowerCase() === "min" ? `a tela tem ${px} ou mais` : `a tela tem até ${px}`;
	}

	if (/prefers-color-scheme:\s*dark/i.test(limpa)) return "o sistema está em modo escuro";
	if (/prefers-color-scheme:\s*light/i.test(limpa)) return "o sistema está em modo claro";
	if (/prefers-reduced-motion/i.test(limpa)) return "a pessoa pediu menos animação no sistema";
	if (/^print$/i.test(limpa)) return "só na impressão";

	return null;
}

/** `48rem` → "768px". A conversão assume 16px por rem, que é o padrão do navegador. */
function emPixels(numero: number, unidade: string): string {
	if (unidade.toLowerCase() === "px") return `${numero}px`;
	return `${Math.round(numero * 16)}px`;
}

/**
 * Explica UM alvo: `.controle:hover`, `button:not(:disabled)`, `svg[stroke]`.
 *
 * Monta a frase a partir do que reconhece, e desiste (null) quando não sobra nada de útil — uma
 * explicação pela metade confunde mais do que o seletor cru.
 */
function explicarAlvo(alvo: string): string | null {
	const partes: string[] = [];

	// `:not(...)` sai primeiro, senão suas entranhas seriam lidas como estado do próprio alvo.
	const semNot = alvo.replace(/:not\(([^)]*)\)/g, (_, dentro: string) => {
		partes.push(`exceto ${descreverSimples(dentro.trim())}`);
		return "";
	});

	// Estados e pseudo-elementos.
	const pseudos = semNot.match(/::?[\w-]+/g) ?? [];
	for (const pseudo of pseudos) {
		const achado = ESTADOS.find(([padrao]) => padrao.test(pseudo));
		if (achado) partes.push(achado[1]);
	}

	// Atributo: `[stroke]`, `[role="button"]`.
	const atributos = semNot.match(/\[[^\]]+\]/g) ?? [];
	for (const atributo of atributos) {
		const corpo = atributo.slice(1, -1);
		const comValor = corpo.match(/^([\w-]+)\s*=\s*["']?([^"']+)["']?$/);
		if (comValor) partes.push(`tem ${comValor[1]}="${comValor[2]}"`);
		else partes.push(`tem o atributo ${corpo}`);
	}

	if (partes.length === 0) return null;
	return partes.join(", ");
}

/** Descrição curta para dentro de `:not(...)`. */
function descreverSimples(trecho: string): string {
	const achado = ESTADOS.find(([padrao]) => padrao.test(trecho));
	if (achado) return `quando ${achado[1]}`;

	const atributo = trecho.match(/^\[([\w-]+)\s*=\s*["']?([^"']+)["']?\]$/);
	if (atributo) return `com ${atributo[1]}="${atributo[2]}"`;

	return trecho;
}

/**
 * Divide uma lista de seletores nas vírgulas de TOPO.
 *
 * As vírgulas dentro de `:not(...)` e `[attr="a,b"]` não separam alvos — cortar nelas contaria
 * elementos que não existem.
 */
function dividirTopo(seletor: string): string[] {
	const partes: string[] = [];
	let profundidade = 0;
	let aspas: string | null = null;
	let atual = "";

	for (const c of seletor) {
		if (aspas) {
			if (c === aspas) aspas = null;
			atual += c;
			continue;
		}
		if (c === '"' || c === "'") {
			aspas = c;
			atual += c;
			continue;
		}
		if (c === "(" || c === "[") profundidade++;
		else if (c === ")" || c === "]") profundidade--;

		if (c === "," && profundidade === 0) {
			partes.push(atual.trim());
			atual = "";
			continue;
		}
		atual += c;
	}
	if (atual.trim()) partes.push(atual.trim());

	return partes;
}
