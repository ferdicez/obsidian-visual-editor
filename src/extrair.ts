/**
 * Extrair um valor para variável, e ligar uma propriedade a uma variável existente.
 *
 * **Estas são as únicas operações do plugin que ACRESCENTAM linha ao arquivo.** Todo o resto
 * reescreve apenas os caracteres de um valor. Por isso elas moram num módulo à parte, com as
 * proteções explícitas: quem lê `documento.ts` continua vendo a garantia antiga intacta, e quem
 * mexer aqui vê logo de cara que está no território perigoso.
 *
 * As três regras que sustentam a segurança:
 *
 * 1. **Nada é inventado.** Sem uma casa de token no arquivo (`:root` ou `@theme`), a extração é
 *    RECUSADA — o plugin não escolhe um lugar para criar a declaração. Errar isso produziria CSS
 *    válido no lugar errado, que é exatamente o tipo de estrago silencioso que ela não teria como
 *    perceber.
 * 2. **Nome novo nunca colide.** Um nome já usado seria redeclaração — o valor antigo passaria a
 *    valer para quem já usava a variável.
 * 3. **A inserção é feita depois da troca.** Inserir primeiro deslocaria o `inicio`/`fim` da
 *    propriedade e a troca cairia no lugar errado.
 */

import { Campo } from "./tipos";

export interface ResultadoExtracao {
	ok: boolean;
	/** O texto novo do arquivo. Igual ao original quando `ok` é falso. */
	texto: string;
	/** Por que não deu, para a interface avisar em vez de falhar em silêncio. */
	erro?: string;
	/**
	 * O bloco que recebeu a declaração (`:root`, `@theme`…), para o aviso dizer onde ela foi parar.
	 * Quem extrai num arquivo Tailwind precisa saber que caiu no `@theme` — é o que explica a
	 * classe utilitária aparecer junto.
	 */
	casa?: string;
}

/** Um nome é um identificador CSS válido de custom property? */
export function nomeValido(nome: string): boolean {
	return /^--[a-zA-Z][\w-]*$/.test(nome);
}

/**
 * Onde a declaração nova entra: dentro da PRIMEIRA casa de token de topo do arquivo — o `:root`,
 * ou o `@theme` do Tailwind v4 (ver `ehSeletorRoot`).
 *
 * "De topo" importa: um `:root` dentro de `@media` vale só naquela largura, e criar o token lá o
 * deixaria indefinido no resto do site — a página quebraria fora daquela media query.
 *
 * Devolve a posição logo depois do `{`, e a indentação usada pelas declarações existentes.
 */
function acharRoot(texto: string): { posicao: number; indentacao: string; casa: string } | null {
	let profundidade = 0;
	let i = 0;
	let inicioTrecho = 0;

	while (i < texto.length) {
		const c = texto[i];

		if (c === "/" && texto[i + 1] === "*") {
			const fim = texto.indexOf("*/", i + 2);
			i = fim === -1 ? texto.length : fim + 2;
			inicioTrecho = i;
			continue;
		}

		if (c === '"' || c === "'") {
			const aspa = c;
			i++;
			while (i < texto.length) {
				if (texto[i] === "\\") { i += 2; continue; }
				if (texto[i] === aspa) { i++; break; }
				i++;
			}
			continue;
		}

		if (c === "{") {
			const seletor = texto.slice(inicioTrecho, i).trim().replace(/\s+/g, " ");
			// Só interessa o `:root` que está na raiz do arquivo (profundidade 0).
			if (profundidade === 0 && ehSeletorRoot(seletor)) {
				return { posicao: i + 1, indentacao: indentacaoDe(texto, i + 1), casa: seletor };
			}
			profundidade++;
			i++;
			inicioTrecho = i;
			continue;
		}

		if (c === "}") {
			profundidade--;
			i++;
			inicioTrecho = i;
			continue;
		}

		i++;
	}

	return null;
}

/**
 * `:root`, `html`, os dois juntos — ou `@theme`. A casa dos tokens.
 *
 * **`@theme` entrou por causa do Tailwind v4**, onde ele é a casa dos tokens no lugar do `:root`:
 * declarar `--color-roxo` ali é o que gera as classes `bg-roxo`/`text-roxo`, e um token criado num
 * `:root` à parte existiria como variável mas não viraria classe nenhuma. Recusar a extração num
 * arquivo desses obrigaria a abrir o editor de código justamente onde o plugin deveria bastar.
 *
 * A garantia de `acharRoot` continua valendo igual: só vale o bloco de topo (`profundidade === 0`),
 * então um `@theme` aninhado dentro de `@media` não é escolhido — é a mesma proteção que já existia
 * para o `:root`, pelo mesmo motivo.
 */
function ehSeletorRoot(seletor: string): boolean {
	const limpo = seletor.trim().toLowerCase();

	// `@theme` pode vir com nome de camada (`@theme inline`, `@theme static`) — todas declaram token.
	if (limpo === "@theme" || limpo.startsWith("@theme ")) return true;

	const alvos = limpo.split(",").map((s) => s.trim());
	return alvos.length > 0 && alvos.every((alvo) => alvo === ":root" || alvo === "html");
}

/**
 * A indentação das declarações dentro do bloco, copiada da primeira linha com conteúdo.
 *
 * Copiar em vez de assumir um tab: o arquivo dela pode usar espaços, e uma linha desalinhada no meio
 * do `:root` é a marca de "um programa mexeu aqui" que a promessa do plugin quer evitar.
 */
function indentacaoDe(texto: string, depoisDaChave: number): string {
	const trecho = texto.slice(depoisDaChave, depoisDaChave + 400);
	const linha = trecho.match(/\n([ \t]+)\S/);
	return linha ? linha[1] : "\t";
}

/**
 * Extrai o valor de uma propriedade para uma variável nova.
 *
 * Faz duas coisas no arquivo: troca o valor da propriedade por `var(--nome)` e declara `--nome` no
 * `:root`. É a operação que ela pediu como "virar variável".
 */
export function extrairVariavel(
	texto: string,
	campo: Campo,
	nome: string,
	declaradas: string[]
): ResultadoExtracao {
	if (!nomeValido(nome)) {
		return { ok: false, texto, erro: "O nome precisa começar com -- e conter só letras, números e hífens." };
	}

	if (declaradas.includes(nome)) {
		return { ok: false, texto, erro: `A variável ${nome} já existe neste arquivo.` };
	}

	const root = acharRoot(texto);
	if (!root) {
		return {
			ok: false,
			texto,
			erro: "Este arquivo não tem um bloco :root nem @theme para receber a variável. Crie um e tente de novo.",
		};
	}

	// A propriedade tem de vir DEPOIS do ponto de inserção para a ordem de escrita abaixo valer.
	// Uma casa de token declarada no fim do arquivo (raro, mas possível) cairia neste caso.
	if (campo.inicio < root.posicao) {
		return {
			ok: false,
			texto,
			erro: "A regra está antes do bloco de tokens — extrair aqui deixaria a variável indefinida no uso.",
		};
	}

	const valor = campo.valor;

	// Trocar PRIMEIRO (posição mais adiante), inserir DEPOIS: a ordem inversa deslocaria `campo.inicio`.
	let novo = texto.slice(0, campo.inicio) + `var(${nome})` + texto.slice(campo.fim);
	novo = novo.slice(0, root.posicao) + `\n${root.indentacao}${nome}: ${valor};` + novo.slice(root.posicao);

	return { ok: true, texto: novo, casa: root.casa };
}

/**
 * Liga uma propriedade a uma variável que já existe: o valor vira `var(--nome)`.
 *
 * Não acrescenta linha — é uma troca de valor comum, e por isso não precisa das proteções acima.
 * Vive aqui por parentesco com a extração: as duas respondem à mesma pergunta na interface.
 */
export function ligarVariavel(texto: string, campo: Campo, nome: string): ResultadoExtracao {
	if (!nomeValido(nome)) {
		return { ok: false, texto, erro: "Nome de variável inválido." };
	}
	return {
		ok: true,
		texto: texto.slice(0, campo.inicio) + `var(${nome})` + texto.slice(campo.fim),
	};
}

/**
 * As variáveis que fazem sentido oferecer para uma propriedade.
 *
 * Filtra por AFINIDADE: oferecer `--fonte-titulo` para um `border-radius` é ruído, e uma lista de 24
 * variáveis onde 3 servem faz ela desistir de usar o menu. A afinidade é deduzida do tipo do valor
 * (uma cor casa com cor) e do nome da propriedade (`padding` casa com `--espaco-*`).
 *
 * Quando nada casa, devolve todas: é melhor uma lista longa do que um menu vazio que parece defeito.
 */
export function variaveisCompativeis(campo: Campo, variaveis: Campo[]): Campo[] {
	const propriedade = (campo.propriedade ?? "").toLowerCase();

	const casaPorTipo = variaveis.filter((v) => v.tipo === campo.tipo);

	const familia = FAMILIAS.find(([padrao]) => padrao.test(propriedade));
	const casaPorNome = familia
		? variaveis.filter((v) => familia[1].test(v.nomeReal))
		: [];

	const juntos = [...new Set([...casaPorNome, ...casaPorTipo])];
	return juntos.length > 0 ? juntos : variaveis;
}

/**
 * Propriedade → nomes de variável que costumam servir.
 *
 * Bilíngue de propósito: ela nomeia em português (`--espaco-md`, `--cor-primaria`) e o CSS é em
 * inglês. Só olhar o inglês não acharia nada no arquivo dela.
 */
const FAMILIAS: Array<[RegExp, RegExp]> = [
	[/color|background|fill|stroke|border-color/, /cor|color|paleta|palette|tint/i],
	[/padding|margin|gap|inset|top|left|right|bottom/, /espaco|space|spacing|gap|margin|padding/i],
	[/radius/, /raio|radius|arredond|round/i],
	[/shadow/, /sombra|shadow|elevacao|elevation/i],
	[/font-family/, /fonte|font|family|tipografia|typeface/i],
	[/font-size/, /tamanho|size|escala|scale/i],
	[/font-weight/, /peso|weight/i],
	[/line-height/, /altura-?linha|line-?height|entrelinha/i],
	[/transition|animation/, /transicao|transition|duracao|duration|easing/i],
	[/width|height|size/, /largura|altura|width|height|tamanho|size/i],
	[/z-index/, /camada|layer|z-?index|nivel/i],
	[/opacity/, /opacidade|opacity|alpha/i],
];
