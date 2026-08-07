import { deduzir } from "./deduzir";
import { Campo, Documento, humanizar } from "./tipos";

/**
 * Lê um JSON localizando a POSIÇÃO de cada valor escalar no texto.
 *
 * Por que não `JSON.parse` + `JSON.stringify`: porque o round-trip reescreve o arquivo inteiro.
 * Ele perde comentários (num tsconfig ou num .jsonc), normaliza a indentação, reordena nada mas
 * reformata tudo, e transforma um diff de uma linha num diff de trezentas. Como o objetivo é
 * mexer no projeto dela sem sujar o histórico, o leitor guarda deslocamentos e a escrita troca só
 * os caracteres do valor — igual ao CSS.
 *
 * Aceita também `//` e comentários de bloco, para servir a tsconfig.json e afins.
 *
 * Só valores ESCALARES viram campo (string, número, booleano). Objetos e arrays viram estrutura de
 * agrupamento: um array de objetos aparece como grupos numerados, e cada folha dentro dele é
 * editável. O que não é folha não é reescrito.
 */
export function lerJson(texto: string): Documento {
	const campos: Campo[] = [];
	let naoEditaveis = 0;
	let i = 0;

	/** Avança sobre espaços e comentários — os dois são "nada" para o parser. */
	function pularVazio(): void {
		while (i < texto.length) {
			const c = texto[i];
			if (/\s/.test(c)) {
				i++;
				continue;
			}
			if (c === "/" && texto[i + 1] === "/") {
				const quebra = texto.indexOf("\n", i);
				i = quebra === -1 ? texto.length : quebra;
				continue;
			}
			if (c === "/" && texto[i + 1] === "*") {
				const fim = texto.indexOf("*/", i + 2);
				i = fim === -1 ? texto.length : fim + 2;
				continue;
			}
			return;
		}
	}

	/** Lê uma string entre aspas e devolve o conteúdo já sem escape. */
	function lerString(): { valor: string; inicio: number; fim: number } | null {
		if (texto[i] !== '"') return null;
		const inicio = i;
		i++;
		let bruto = "";
		while (i < texto.length) {
			const c = texto[i];
			if (c === "\\") {
				bruto += texto.slice(i, i + 2);
				i += 2;
				continue;
			}
			if (c === '"') {
				i++;
				return { valor: desescapar(bruto), inicio, fim: i };
			}
			bruto += c;
			i++;
		}
		return null;
	}

	/**
	 * Lê um valor qualquer. `caminho` é a chave completa (`tema.cores.primaria`), que serve tanto de
	 * identificador estável quanto de rótulo. `grupo` é o objeto pai, para a interface agrupar.
	 */
	function lerValor(caminho: string, grupo: string, descricao?: string): void {
		pularVazio();
		if (i >= texto.length) return;

		const c = texto[i];

		if (c === "{") {
			i++;
			lerObjeto(caminho);
			return;
		}

		if (c === "[") {
			i++;
			lerArray(caminho);
			return;
		}

		// --- Escalar: é aqui que nasce um campo ------------------------------------------
		const nome = caminho.split(".").pop() ?? caminho;

		if (c === '"') {
			const s = lerString();
			if (!s) return;
			// `inicio`/`fim` incluem as aspas de propósito: a escrita devolve o valor JÁ escapado e
			// entre aspas, então o pedaço trocado tem que ser o literal inteiro.
			campos.push({
				chave: caminho,
				nomeReal: caminho,
				rotulo: humanizar(nome),
				valor: s.valor,
				inicio: s.inicio,
				fim: s.fim,
				grupo,
				descricao,
				origemComAspas: true,
				...deduzir(nome, s.valor),
			});
			return;
		}

		const inicio = i;
		while (i < texto.length && !/[,}\]\s]/.test(texto[i])) i++;
		const bruto = texto.slice(inicio, i);
		if (!bruto) return;

		// `null` não tem controle próprio: virar campo de texto faria ela digitar a palavra "null"
		// e o plugin gravaria a string "null", mudando o tipo. Fica de fora.
		if (bruto === "null") {
			naoEditaveis++;
			return;
		}

		campos.push({
			chave: caminho,
			nomeReal: caminho,
			rotulo: humanizar(nome),
			valor: bruto,
			inicio,
			fim: i,
			grupo,
			descricao,
			origemComAspas: false,
			...deduzir(nome, bruto),
		});
	}

	function lerObjeto(caminho: string): void {
		while (i < texto.length) {
			pularVazio();
			if (texto[i] === "}") {
				i++;
				return;
			}
			if (texto[i] === ",") {
				i++;
				continue;
			}

			// Um comentário logo acima da chave vira a descrição do campo.
			const descricao = comentarioAntes(texto, i);

			const chave = lerString();
			if (!chave) {
				// Chave malformada: aborta o objeto em vez de arriscar deslocamentos errados. Melhor
				// mostrar menos campos do que gravar em cima do lugar errado.
				i++;
				continue;
			}

			pularVazio();
			if (texto[i] !== ":") continue;
			i++;

			const filho = caminho ? `${caminho}.${chave.valor}` : chave.valor;
			lerValor(filho, caminho || "(raiz)", descricao);
		}
	}

	function lerArray(caminho: string): void {
		let indice = 0;
		while (i < texto.length) {
			pularVazio();
			if (texto[i] === "]") {
				i++;
				return;
			}
			if (texto[i] === ",") {
				i++;
				continue;
			}
			lerValor(`${caminho}[${indice}]`, caminho);
			indice++;
		}
	}

	pularVazio();
	if (texto[i] === "{") {
		i++;
		lerObjeto("");
	} else if (texto[i] === "[") {
		i++;
		lerArray("");
	}

	return { campos, naoEditaveis };
}

/**
 * O valor a GRAVAR no arquivo, dado o que a usuária digitou.
 *
 * Uma string precisa voltar entre aspas e com escape; um número ou booleano, não. Sem isto, editar
 * um texto com aspas ou barra invertida geraria JSON inválido — e o projeto dela pararia de subir.
 */
export function serializarValorJson(campo: Campo, novo: string): string {
	if (!campo.origemComAspas) return novo;
	return JSON.stringify(novo);
}

/** Desfaz o escape JSON de um trecho já sem as aspas externas. */
function desescapar(bruto: string): string {
	try {
		return JSON.parse(`"${bruto}"`);
	} catch {
		return bruto;
	}
}

/**
 * Pega o comentário (`//` ou de bloco) IMEDIATAMENTE acima da posição, se houver.
 *
 * "Imediatamente" é literal: na linha anterior, sem linha em branco no meio. Um comentário
 * separado por uma linha vazia é cabeçalho do arquivo ou da seção, não descrição do próximo campo
 * — e exibi-lo como descrição diria uma coisa errada sobre aquele campo específico.
 */
function comentarioAntes(texto: string, posicao: number): string | undefined {
	let j = posicao - 1;
	while (j >= 0 && /[ \t]/.test(texto[j])) j--;
	if (texto[j] !== "\n") return undefined;

	// Consome UMA quebra de linha e o espaço de indentação da linha de cima. Se esbarrar noutra
	// quebra, havia linha em branco: o comentário não pertence a este campo.
	j--;
	while (j >= 0 && /[ \t]/.test(texto[j])) j--;
	if (j >= 0 && texto[j] === "\n") return undefined;

	if (texto[j] === "/" && texto[j - 1] === "*") {
		const abre = texto.lastIndexOf("/*", j);
		if (abre === -1) return undefined;
		return texto
			.slice(abre + 2, j - 1)
			.split("\n")
			.map((l) => l.replace(/^\s*\*+\s?/, "").trim())
			.filter(Boolean)
			.join(" ");
	}

	const inicioLinha = texto.lastIndexOf("\n", j) + 1;
	const linha = texto.slice(inicioLinha, j + 1).trim();
	if (linha.startsWith("//")) return linha.slice(2).trim();

	return undefined;
}
