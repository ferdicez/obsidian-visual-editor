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
	/**
	 * O último comentário que parece TÍTULO DE SEÇÃO (`/* === Cores === *​/`), e não descrição.
	 *
	 * Vale até o próximo — é o que permite agrupar a tela pela organização que ela já escreveu no
	 * arquivo, em vez de pelo seletor CSS, que joga tudo num `:root` só.
	 */
	let secaoAtual = "";

	let i = 0;
	const n = texto.length;

	while (i < n) {
		const c = texto[i];

		// --- Comentário -------------------------------------------------------------------
		if (c === "/" && texto[i + 1] === "*") {
			const fim = texto.indexOf("*/", i + 2);
			const corpo = texto.slice(i + 2, fim === -1 ? n : fim);
			const limpo = limparComentario(corpo);

			// Um comentário decorado (`=== Cores ===`, `--- Cores ---`) é cabeçalho, não descrição de
			// campo. Vira título de seção e NÃO é oferecido como descrição do campo seguinte: usá-lo
			// nos dois papéis repetiria "Cores" embaixo da primeira variável de cada bloco.
			const titulo = tituloDeSecao(limpo);
			if (titulo) {
				secaoAtual = titulo;
				comentarioPendente = "";
				fimComentario = -1;
			} else {
				comentarioPendente = limpo;
				fimComentario = fim === -1 ? n : fim + 2;
			}

			i = fim === -1 ? n : fim + 2;
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
					secao: secaoAtual || undefined,
					prefixo: prefixoDe(nome),
					descricao: colado ? comentarioPendente : undefined,
					...deducao,
				});

				comentarioPendente = "";
				i = proximo;
				inicioTrecho = i;
				continue;
			}
		}

		// --- Declaração comum (`padding: 16px`, `box-shadow: var(--x)`) ------------------
		//
		// São os USOS: o que cada elemento faz com os tokens. Viram campos com `papel:
		// "propriedade"` para a interface poder mostrar a regra e ligar o valor a uma variável.
		//
		// Só dentro de bloco, e só quando o bloco é uma REGRA de verdade — declarações soltas dentro
		// de `@keyframes` ou `@font-face` não são elemento da página, e mexer nelas por engano é o
		// tipo de coisa que estraga a animação sem ela entender por quê.
		if (
			pilha.length > 0 &&
			ehInicioDePropriedade(texto, i) &&
			blocoEhRegra(pilha) &&
			comecaDeclaracao(texto, i)
		) {
			const declaracao = lerPropriedade(texto, i);
			if (declaracao) {
				const { nome, valor, inicioValor, fimValor, proximo } = declaracao;

				const seletor = pilha.filter(Boolean).join(" › ");
				const usadas = variaveisEm(valor);

				// A chave precisa ser única no arquivo: o mesmo `padding` aparece em muitas regras, e a
				// escrita casa por chave. Seletor + propriedade + ocorrência dá a unicidade sem perder
				// legibilidade em depuração.
				const base = `${seletor}|${nome}`;
				const ocorrencia = (vistas.get(base) ?? 0) + 1;
				vistas.set(base, ocorrencia);

				const colado =
					comentarioPendente !== "" &&
					fimComentario !== -1 &&
					texto.slice(fimComentario, i).trim() === "";

				campos.push({
					chave: ocorrencia === 1 ? base : `${base}@${ocorrencia}`,
					nomeReal: nome,
					rotulo: humanizar(nome),
					valor,
					inicio: inicioValor,
					fim: fimValor,
					grupo: seletor,
					secao: secaoAtual || undefined,
					prefixo: prefixoDe(nome),
					papel: "propriedade",
					seletor,
					propriedade: nome,
					variaveisUsadas: usadas,
					descricao: colado ? comentarioPendente : undefined,
					...deduzir(nome, valor),
				});

				comentarioPendente = "";
				i = proximo;
				inicioTrecho = i;
				continue;
			}
		}

		// --- O que sobrou: conta para o aviso de "há coisas aqui que a interface não edita" ---
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

/** Uma letra aqui pode começar o nome de uma propriedade CSS (`padding`, `-webkit-x`)? */
function ehInicioDePropriedade(texto: string, posicao: number): boolean {
	const c = texto[posicao];
	// `--` já foi tratado antes como variável; um `-` sozinho é prefixo de fabricante.
	if (c === "-") return texto[posicao + 1] !== "-";
	return /[a-z]/i.test(c);
}

/**
 * O bloco mais interno é uma REGRA de estilo, e não outra coisa?
 *
 * `@keyframes girar { from { opacity: 0 } }` tem declarações que parecem propriedades mas descrevem
 * quadros de animação, não um elemento. `@font-face` idem. Mostrá-las como "elementos da página"
 * confundiria, e oferecer "extrair variável" ali produziria CSS que não faz o que ela espera.
 *
 * Um `:root` também não entra: ele é a casa dos tokens, e suas declarações comuns (se houver) não
 * são estilo de elemento nenhum.
 */
function blocoEhRegra(pilha: string[]): boolean {
	const interno = pilha[pilha.length - 1] ?? "";
	if (!interno) return false;

	// Dentro de @keyframes o bloco interno é `from`/`to`/`50%` — o pai é que denuncia.
	const temAtRegraProibida = pilha.some((nivel) =>
		/^@(keyframes|font-face|counter-style|property|page)/i.test(nivel.trim())
	);
	if (temAtRegraProibida) return false;

	if (/^@/.test(interno.trim())) return false;

	// `:root` e `html`/`:root` combinados são a casa dos tokens, não um elemento a estilizar.
	const alvos = interno.split(",").map((s) => s.trim());
	if (alvos.every((alvo) => /^(:root|html)$/i.test(alvo))) return false;

	return true;
}

/**
 * Lê `propriedade: valor;` a partir da primeira letra do nome.
 *
 * Mesma mecânica de `lerDeclaracao` (respeitar parênteses e aspas, recuar sobre o espaço final), com
 * uma diferença: o nome não pode conter `:` — senão um seletor mal fechado viraria propriedade.
 */
function lerPropriedade(texto: string, posicao: number): Declaracao | null {
	let i = posicao;

	while (i < texto.length && /[\w-]/.test(texto[i])) i++;
	const nome = texto.slice(posicao, i);
	if (!nome || !/^-?[a-z][\w-]*$/i.test(nome)) return null;

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
		// Um `{` no meio do "valor" significa que isto era um seletor, não uma declaração.
		else if (profundidade === 0 && c === "{") return null;

		i++;
	}

	let fimValor = i;
	while (fimValor > inicioValor && /\s/.test(texto[fimValor - 1])) fimValor--;

	const valor = texto.slice(inicioValor, fimValor);
	if (!valor) return null;

	const proximo = texto[i] === ";" ? i + 1 : i;

	return { nome, valor, inicioValor, fimValor, proximo };
}

/** As variáveis que um valor referencia: `var(--a) var(--b)` → ["--a", "--b"]. */
function variaveisEm(valor: string): string[] {
	const achadas = valor.match(/var\(\s*(--[\w-]+)/g) ?? [];
	return achadas.map((m) => m.replace(/^var\(\s*/, ""));
}

/**
 * O comentário é um CABEÇALHO DE SEÇÃO, e não a descrição de uma variável?
 *
 * A pista é a decoração: quem escreve `=== Cores ===` ou `--- Espaçamento ---` está separando o
 * arquivo em partes, não explicando o valor abaixo. Um comentário curto sem decoração continua
 * sendo descrição — é o caso muito mais comum, e transformá-lo em título criaria uma seção nova a
 * cada variável comentada.
 *
 * Devolve o título já sem a decoração, ou "" quando não é cabeçalho.
 */
function tituloDeSecao(limpo: string): string {
	if (!limpo) return "";

	// A decoração tem de ser mesmo decoração: três ou mais repetições do mesmo caractere.
	const decorado = /^[=\-*_~#]{3,}|[=\-*_~#]{3,}$/.test(limpo);
	if (!decorado) return "";

	const titulo = limpo.replace(/^[=\-*_~#\s]+/, "").replace(/[=\-*_~#\s]+$/, "").trim();

	// Uma linha só de decoração (`/* ======== */`) não titula nada — é régua visual.
	if (!titulo) return "";

	// Um cabeçalho é um rótulo, não um parágrafo. Se veio texto longo, era comentário explicativo
	// que por acaso tinha traços — melhor devolver ao papel de descrição.
	if (titulo.length > 40) return "";

	return titulo;
}

/**
 * O prefixo do nome, para o agrupamento automático: `--color-linha` → "color".
 *
 * É o agrupamento que funciona sem ela mexer no arquivo. Obedece à nomenclatura que ela já usa —
 * por isso só vale quando existe um separador de verdade; um nome de palavra única não tem prefixo
 * e cai no grupo "Outros" na hora de montar a tela.
 */
function prefixoDe(nome: string): string | undefined {
	const limpo = nome.replace(/^--/, "");

	const porSeparador = limpo.match(/^([a-z0-9]+)[-_.]/i);
	if (porSeparador) return porSeparador[1].toLowerCase();

	// camelCase conta como separador: `corPrimaria` → "cor".
	const porCaixa = limpo.match(/^([a-z0-9]+)(?=[A-Z])/);
	if (porCaixa) return porCaixa[1].toLowerCase();

	return undefined;
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
