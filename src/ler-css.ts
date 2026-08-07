import { deduzir } from "./deduzir";
import { Campo, Documento, humanizar } from "./tipos";

/**
 * Lê as VARIÁVEIS CSS (`--nome: valor;`) de um arquivo, e só elas.
 *
 * Não é um parser de CSS: é um localizador de declarações de custom property. Media queries,
 * @keyframes, seletores encadeados e tudo o mais passam por aqui sem serem tocados — não viram
 * campo, e o que não vira campo nunca é reescrito. Essa é a decisão de projeto que torna seguro
 * abrir o `global.css` de um projeto de verdade.
 *
 * O que ele acha:
 *   :root { --cor-primaria: #e63946; }   ← campo
 *   .botao { padding: 12px; }             ← ignorado (não é variável)
 *
 * Varrer caractere a caractere em vez de usar uma regex sobre o arquivo todo é o que permite
 * pular strings e comentários com precisão. Um `content: "--nao: sou variavel;"` dentro de aspas
 * não pode virar campo, e uma regex ingênua cairia nessa.
 */
export function lerCss(texto: string): Documento {
	const campos: Campo[] = [];
	let naoEditaveis = 0;

	/**
	 * Quantas vezes cada variável já apareceu.
	 *
	 * A MESMA variável costuma ser declarada mais de uma vez — é assim que se faz tema escuro e
	 * ponto de quebra (`--espaco-md: 16px` no `:root`, `8px` dentro da media query). As duas são
	 * campos distintos e precisam de chaves distintas: a escrita casa por chave, então chaves
	 * iguais fariam editar uma gravar nas duas.
	 */
	const vistas = new Map<string, number>();

	/** Onde estamos: a pilha de seletores abertos, para nomear o grupo de cada campo. */
	const pilha: string[] = [];
	/** O começo do trecho ainda não consumido — vira o seletor quando encontramos um `{`. */
	let inicioTrecho = 0;
	/** O último comentário visto, que vira descrição do próximo campo. */
	let comentarioPendente = "";
	/** Em que posição o comentário pendente terminou, para saber se ele "cola" no campo seguinte. */
	let fimComentario = -1;

	let i = 0;
	const n = texto.length;

	while (i < n) {
		const c = texto[i];

		// --- Comentário -------------------------------------------------------------------
		if (c === "/" && texto[i + 1] === "*") {
			const fim = texto.indexOf("*/", i + 2);
			const corpo = texto.slice(i + 2, fim === -1 ? n : fim);
			comentarioPendente = limparComentario(corpo);
			i = fim === -1 ? n : fim + 2;
			fimComentario = i;
			inicioTrecho = i;
			continue;
		}

		// --- String ----------------------------------------------------------------------
		// Pular por inteiro: nada dentro de aspas é declaração.
		if (c === '"' || c === "'") {
			i = pularString(texto, i);
			continue;
		}

		// --- Abre bloco ------------------------------------------------------------------
		if (c === "{") {
			const seletor = texto.slice(inicioTrecho, i).trim().replace(/\s+/g, " ");
			pilha.push(seletor);
			i++;
			inicioTrecho = i;
			comentarioPendente = "";
			continue;
		}

		// --- Fecha bloco -----------------------------------------------------------------
		if (c === "}") {
			pilha.pop();
			i++;
			inicioTrecho = i;
			comentarioPendente = "";
			continue;
		}

		// --- Declaração de variável ------------------------------------------------------
		// Só interessa `--nome` que comece uma declaração, e só dentro de um bloco.
		if (c === "-" && texto[i + 1] === "-" && pilha.length > 0 && comecaDeclaracao(texto, i)) {
			const declaracao = lerDeclaracao(texto, i);
			if (declaracao) {
				const { nome, valor, inicioValor, fimValor, proximo } = declaracao;
				const deducao = deduzir(nome, valor);

				// O comentário só descreve o campo se estiver logo antes dele: entre um e outro pode
				// haver espaço e quebra de linha, mas não outra declaração. Sem essa checagem, um
				// comentário de cabeçalho de seção viraria descrição de um campo lá embaixo.
				const colado =
					comentarioPendente !== "" &&
					fimComentario !== -1 &&
					texto.slice(fimComentario, i).trim() === "";

				// O grupo é o contexto inteiro (`@media … › :root`), e não só o bloco mais interno:
				// dois `:root` em condições diferentes são seções diferentes para quem lê a tela.
				const grupo = pilha.filter(Boolean).join(" › ") || ":root";

				// A ocorrência entra na chave a partir da segunda: a primeira fica com o nome limpo,
				// e só as repetições ganham sufixo. Assim o caso comum (variável declarada uma vez)
				// não carrega ruído no identificador.
				const ocorrencia = (vistas.get(nome) ?? 0) + 1;
				vistas.set(nome, ocorrencia);
				const chave = ocorrencia === 1 ? nome : `${nome}@${ocorrencia}`;

				campos.push({
					chave,
					nomeReal: nome,
					rotulo: humanizar(nome),
					valor,
					inicio: inicioValor,
					fim: fimValor,
					grupo,
					descricao: colado ? comentarioPendente : undefined,
					...deducao,
				});

				comentarioPendente = "";
				i = proximo;
				inicioTrecho = i;
				continue;
			}
		}

		// --- Declaração comum (não é variável) -------------------------------------------
		// Conta para o aviso de "há coisas aqui que a interface não edita".
		if (c === ";" && pilha.length > 0) {
			const trecho = texto.slice(inicioTrecho, i).trim();
			if (trecho && !trecho.startsWith("--")) naoEditaveis++;
			i++;
			inicioTrecho = i;
			continue;
		}

		i++;
	}

	return { campos, naoEditaveis };
}

/**
 * A `--` está no começo de uma declaração, e não no meio de um valor?
 *
 * `--gap: 4px` é declaração. O `--x` dentro de `calc(var(--x) - --y)` não é. A diferença é o que
 * vem ANTES: uma declaração só pode ser precedida por `{`, `;` ou espaço em branco desde um deles.
 */
function comecaDeclaracao(texto: string, posicao: number): boolean {
	for (let j = posicao - 1; j >= 0; j--) {
		const c = texto[j];
		if (c === "{" || c === ";" || c === "}") return true;
		// Fim de comentário. Varrendo PARA TRÁS, o `/` vem primeiro e o `*` logo antes dele — a
		// ordem é o inverso da leitura natural, e trocá-la faz a primeira variável depois de um
		// comentário sumir da interface.
		if (c === "/" && texto[j - 1] === "*") return true;
		if (!/\s/.test(c)) return false;
	}
	// Começo do arquivo: não estamos dentro de bloco nenhum, então não é declaração válida.
	return false;
}

interface Declaracao {
	nome: string;
	valor: string;
	inicioValor: number;
	fimValor: number;
	proximo: number;
}

/**
 * Lê `--nome: valor;` a partir do `-` inicial.
 *
 * O valor termina no `;` ou no `}` que fecha o bloco (a última declaração pode não ter `;`), e
 * respeita parênteses e aspas: `rgba(0, 0, 0, .5)` não é cortado na vírgula, e um `;` dentro de
 * aspas não termina a declaração.
 */
function lerDeclaracao(texto: string, posicao: number): Declaracao | null {
	let i = posicao + 2;
	const inicioNome = posicao;

	while (i < texto.length && /[\w-]/.test(texto[i])) i++;
	const nome = texto.slice(inicioNome, i);
	if (nome.length <= 2) return null;

	while (i < texto.length && /\s/.test(texto[i])) i++;
	if (texto[i] !== ":") return null;
	i++;

	while (i < texto.length && /\s/.test(texto[i])) i++;
	const inicioValor = i;

	let profundidade = 0;
	while (i < texto.length) {
		const c = texto[i];

		if (c === '"' || c === "'") {
			i = pularString(texto, i);
			continue;
		}
		if (c === "(") profundidade++;
		else if (c === ")") profundidade--;
		else if (profundidade === 0 && (c === ";" || c === "}")) break;

		i++;
	}

	// Recuar sobre o espaço final: o valor é `#fff`, não `#fff\n\t`. Sem isto, reescrever comeria a
	// indentação da linha seguinte.
	let fimValor = i;
	while (fimValor > inicioValor && /\s/.test(texto[fimValor - 1])) fimValor--;

	const valor = texto.slice(inicioValor, fimValor);
	if (!valor) return null;

	// `}` não é consumido: quem fecha o bloco é o laço principal, que precisa ver o caractere.
	const proximo = texto[i] === ";" ? i + 1 : i;

	return { nome, valor, inicioValor, fimValor, proximo };
}

/** Pula uma string com aspas, respeitando escape. Devolve a posição logo depois dela. */
function pularString(texto: string, posicao: number): number {
	const aspa = texto[posicao];
	let i = posicao + 1;
	while (i < texto.length) {
		if (texto[i] === "\\") {
			i += 2;
			continue;
		}
		if (texto[i] === aspa) return i + 1;
		i++;
	}
	return i;
}

/** Tira os `*` de enfeite e junta em uma linha só, para caber na descrição do campo. */
function limparComentario(corpo: string): string {
	return corpo
		.split("\n")
		.map((linha) => linha.replace(/^\s*\*+\s?/, "").trim())
		.filter(Boolean)
		.join(" ")
		.trim();
}
