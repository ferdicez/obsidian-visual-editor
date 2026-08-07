import { deduzir } from "./deduzir";
import { Campo, Documento, humanizar } from "./tipos";

/**
 * Lê arquivos de texto no formato `chave = valor` — um por linha.
 *
 * Serve para `.env`, `.ini`, `.properties` e para os arquivinhos de conteúdo que projetos usam
 * para textos de página (`titulo = Bem-vinda`). Aceita `=` e `:` como separador.
 *
 * Cabeçalhos de seção no estilo `.ini` viram grupos:
 *
 *     [rodape]
 *     texto = © 2026        ← grupo "rodape"
 *
 * Linhas que não casam com o formato — texto solto, linha em branco, comentário — não viram campo
 * e portanto nunca são reescritas. Igual aos outros dois leitores.
 */
export function lerTexto(texto: string): Documento {
	const campos: Campo[] = [];
	let naoEditaveis = 0;

	let grupo = "Geral";
	let descricaoPendente = "";
	let posicao = 0;

	for (const linha of texto.split("\n")) {
		const inicioLinha = posicao;
		posicao += linha.length + 1; // +1 pela quebra consumida no split

		const limpa = linha.trim();

		if (!limpa) {
			descricaoPendente = "";
			continue;
		}

		// Comentário: guarda para descrever a próxima chave.
		if (limpa.startsWith("#") || limpa.startsWith(";") || limpa.startsWith("//")) {
			descricaoPendente = limpa.replace(/^[#;]|^\/\//, "").trim();
			continue;
		}

		// Cabeçalho de seção.
		const secao = limpa.match(/^\[(.+)\]$/);
		if (secao) {
			grupo = secao[1].trim();
			descricaoPendente = "";
			continue;
		}

		const separador = acharSeparador(linha);
		if (separador === -1) {
			naoEditaveis++;
			descricaoPendente = "";
			continue;
		}

		const nome = linha.slice(0, separador).trim();
		if (!nome) {
			naoEditaveis++;
			continue;
		}

		// O valor começa depois do separador, pulando o espaço de alinhamento — mas os
		// deslocamentos são medidos no texto ORIGINAL, para a reescrita cair no lugar certo.
		let inicioValor = separador + 1;
		while (inicioValor < linha.length && /[ \t]/.test(linha[inicioValor])) inicioValor++;

		let fimValor = linha.length;
		while (fimValor > inicioValor && /[ \t\r]/.test(linha[fimValor - 1])) fimValor--;

		const valor = linha.slice(inicioValor, fimValor);

		campos.push({
			chave: `${grupo}.${nome}`,
			nomeReal: nome,
			rotulo: humanizar(nome),
			valor,
			inicio: inicioLinha + inicioValor,
			fim: inicioLinha + fimValor,
			grupo,
			descricao: descricaoPendente || undefined,
			...deduzir(nome, valor),
		});

		descricaoPendente = "";
	}

	return { campos, naoEditaveis };
}

/**
 * Acha o separador da linha: o primeiro `=` ou `:` que não esteja dentro de aspas.
 *
 * Um `:` dentro de aspas (`url = "https://exemplo.com"`) não pode ser confundido com separador —
 * senão a chave viraria `url = "https` e a reescrita cortaria a URL ao meio.
 */
function acharSeparador(linha: string): number {
	let dentroDeAspas: string | null = null;

	for (let i = 0; i < linha.length; i++) {
		const c = linha[i];

		if (dentroDeAspas) {
			if (c === "\\") {
				i++;
				continue;
			}
			if (c === dentroDeAspas) dentroDeAspas = null;
			continue;
		}

		if (c === '"' || c === "'") {
			dentroDeAspas = c;
			continue;
		}

		if (c === "=" || c === ":") return i;
	}

	return -1;
}
