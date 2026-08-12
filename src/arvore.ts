/**
 * A árvore de pastas do explorador lateral — só com o que o editor visual sabe abrir.
 *
 * A pergunta que este módulo responde é "onde estão os arquivos que dá para mexer?". O painel
 * nativo do Obsidian mostra o vault inteiro, e num vault que é sobretudo notas os poucos `.css` de
 * projeto ficam perdidos no meio delas.
 *
 * A regra que define tudo: **uma pasta só aparece se tiver, em algum lugar abaixo dela, um arquivo
 * editável.** Uma pasta com 200 notas e nenhum CSS não aparece — não porque as notas não importem,
 * mas porque este explorador não é sobre elas.
 */

import { TAbstractFile, TFile, TFolder, Vault } from "obsidian";

export interface NoPasta {
	tipo: "pasta";
	nome: string;
	caminho: string;
	filhos: No[];
	/** Quantos arquivos editáveis existem abaixo desta pasta, somando as subpastas. */
	quantos: number;
}

export interface NoArquivo {
	tipo: "arquivo";
	nome: string;
	caminho: string;
	arquivo: TFile;
}

export type No = NoPasta | NoArquivo;

/**
 * Monta a árvore a partir da raiz do vault, podando o que não interessa.
 *
 * `editavel` decide o que entra — vem das extensões ligadas nas configurações, então ligar `.json`
 * nas fichas muda esta árvore sem que este módulo saiba o que é uma extensão.
 */
/**
 * Pastas que nunca entram na árvore, mesmo cheias de arquivos editáveis.
 *
 * São pastas de MÁQUINA: dependências instaladas, saída de build, controle de versão. O CSS que
 * mora nelas não é dela — é de biblioteca de terceiros ou gerado a partir do código-fonte, e nos
 * dois casos editar ali é trabalho perdido: o próximo `npm install` ou build sobrescreve.
 *
 * `node_modules` sozinho pode ter milhares de arquivos e afundaria a lista onde estão os dois ou
 * três arquivos que ela realmente mexe.
 */
const PASTAS_IGNORADAS = new Set([
	"node_modules",
	".git",
	".obsidian",
	"dist",
	"build",
	".next",
	".nuxt",
	".svelte-kit",
	"vendor",
	"__pycache__",
	".venv",
	"venv",
	"coverage",
	".cache",
	"out",
	"target",
]);

/** Uma pasta de máquina, que não entra na árvore. */
function ehIgnorada(pasta: TFolder): boolean {
	return PASTAS_IGNORADAS.has(pasta.name.toLowerCase());
}

/**
 * Arquivos de configuração de projeto que não são "coisas para ajustar visualmente".
 *
 * `package-lock.json` é gerado pelo npm; `tsconfig.json` e `package.json` são configuração de
 * build, onde um slider não ajuda e um erro quebra o projeto. Eles apareceram na lista dela assim
 * que `.json` foi ligado, junto dos arquivos que ela realmente queria.
 *
 * O casamento é pelo nome inteiro, não por prefixo: um `package.json` dentro de uma pasta de tema
 * dela continuaria oculto, mas isso é aceitável — arquivo com esse nome é sempre de build.
 */
const ARQUIVOS_IGNORADOS = new Set([
	"package.json",
	"package-lock.json",
	"tsconfig.json",
	"jsconfig.json",
	"composer.json",
	"composer.lock",
	"manifest.json",
	"versions.json",
	"data.json",
	"tsconfig.node.json",
	"tsconfig.app.json",
	"pnpm-lock.yaml",
	"bun.lockb",
]);

function arquivoIgnorado(arquivo: TFile): boolean {
	return ARQUIVOS_IGNORADOS.has(arquivo.name.toLowerCase());
}

export function montarArvore(
	vault: Vault,
	editavel: (arquivo: TFile) => boolean,
	esconderDeMaquina = true
): NoPasta {
	return construir(vault.getRoot(), editavel, esconderDeMaquina);
}

function construir(
	pasta: TFolder,
	editavel: (arquivo: TFile) => boolean,
	esconderDeMaquina: boolean
): NoPasta {
	const filhos: No[] = [];
	let quantos = 0;

	// Pastas antes de arquivos, cada grupo em ordem alfabética — a mesma convenção do explorador
	// nativo. Divergir dela faria a mesma pasta parecer estar em lugares diferentes nos dois painéis.
	const ordenados = [...pasta.children].sort(comparar);

	for (const filho of ordenados) {
		if (filho instanceof TFolder) {
			if (esconderDeMaquina && ehIgnorada(filho)) continue;

			const sub = construir(filho, editavel, esconderDeMaquina);
			// A poda: uma subpasta sem nenhum arquivo editável abaixo não entra na árvore.
			if (sub.quantos > 0) {
				filhos.push(sub);
				quantos += sub.quantos;
			}
			continue;
		}

		if (filho instanceof TFile && editavel(filho) && !(esconderDeMaquina && arquivoIgnorado(filho))) {
			filhos.push({ tipo: "arquivo", nome: filho.name, caminho: filho.path, arquivo: filho });
			quantos++;
		}
	}

	return { tipo: "pasta", nome: pasta.name, caminho: pasta.path, filhos, quantos };
}

function comparar(a: TAbstractFile, b: TAbstractFile): number {
	const aPasta = a instanceof TFolder;
	const bPasta = b instanceof TFolder;
	if (aPasta !== bPasta) return aPasta ? -1 : 1;
	return a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" });
}

/**
 * Filtra a árvore por um texto, mantendo o caminho até cada acerto.
 *
 * Uma pasta continua visível quando ela mesma casa (e aí vem inteira) ou quando algum descendente
 * casa — sem isso, buscar "tokens" esconderia a pasta que contém o `tokens.css` e o resultado ficaria
 * inalcançável.
 *
 * Devolve null quando nada abaixo do nó casa.
 */
export function filtrar(no: No, busca: string): No | null {
	const alvo = busca.trim().toLowerCase();
	if (!alvo) return no;

	if (no.tipo === "arquivo") {
		return no.nome.toLowerCase().includes(alvo) ? no : null;
	}

	// A pasta casou: vem inteira, para ela ver o conteúdo do que procurou.
	if (no.nome.toLowerCase().includes(alvo)) return no;

	const filhos = no.filhos.map((filho) => filtrar(filho, alvo)).filter((filho): filho is No => filho !== null);
	if (filhos.length === 0) return null;

	const quantos = filhos.reduce(
		(soma, filho) => soma + (filho.tipo === "pasta" ? filho.quantos : 1),
		0
	);

	return { ...no, filhos, quantos };
}

/**
 * Os caminhos de todas as pastas da árvore, para "expandir tudo".
 *
 * Numa busca é o que evita ela ter de abrir pasta por pasta para chegar no acerto.
 */
export function caminhosDePastas(no: No, acumulado: string[] = []): string[] {
	if (no.tipo !== "pasta") return acumulado;
	acumulado.push(no.caminho);
	for (const filho of no.filhos) caminhosDePastas(filho, acumulado);
	return acumulado;
}
