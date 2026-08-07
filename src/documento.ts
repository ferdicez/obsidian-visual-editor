import { lerCss } from "./ler-css";
import { lerJson, serializarValorJson } from "./ler-json";
import { lerTexto } from "./ler-texto";
import { Campo, Documento, aplicarValores } from "./tipos";

/** Os formatos que o plugin sabe abrir na interface visual. */
export type Formato = "css" | "json" | "texto";

const POR_EXTENSAO: Record<string, Formato> = {
	css: "css",
	scss: "css",
	sass: "css",
	less: "css",
	json: "json",
	jsonc: "json",
	txt: "texto",
	env: "texto",
	ini: "texto",
	properties: "texto",
	conf: "texto",
};

/** O formato de um arquivo, ou null se não for um dos suportados. */
export function formatoDe(extensao: string): Formato | null {
	return POR_EXTENSAO[extensao.toLowerCase()] ?? null;
}

export function ler(texto: string, formato: Formato): Documento {
	switch (formato) {
		case "css":
			return lerCss(texto);
		case "json":
			return lerJson(texto);
		case "texto":
			return lerTexto(texto);
	}
}

/**
 * Reescreve o arquivo com os valores novos.
 *
 * A serialização depende do formato: em JSON uma string volta com aspas e escape, nos outros o
 * valor entra cru. Fora isso, a mecânica é a mesma nos três — trocar só os caracteres do valor,
 * de trás para frente, deixando o resto do arquivo intacto.
 */
export function escrever(
	original: string,
	campos: Campo[],
	novos: Map<string, string>,
	formato: Formato
): string {
	if (formato !== "json") return aplicarValores(original, campos, novos);

	const serializados = new Map<string, string>();
	for (const campo of campos) {
		const novo = novos.get(campo.chave);
		if (novo === undefined) continue;
		// `aplicarValores` compara com `campo.valor` para saber o que mudou; a comparação tem de ser
		// feita no valor CRU (sem aspas), então guardamos a versão serializada só para a escrita e
		// mantemos a chave igual.
		serializados.set(campo.chave, serializarValorJson(campo, novo));
	}

	// Os campos JSON precisam ser comparados pelo valor serializado também, senão um valor que
	// "não mudou" seria reescrito à toa. Reconstruímos os campos com o valor já serializado.
	const camposSerializados = campos.map((campo) => ({
		...campo,
		valor: serializarValorJson(campo, campo.valor),
	}));

	return aplicarValores(original, camposSerializados, serializados);
}

/** Agrupa os campos na ordem em que os grupos aparecem, para a interface desenhar seções. */
export function agrupar(campos: Campo[]): Map<string, Campo[]> {
	const grupos = new Map<string, Campo[]>();
	for (const campo of campos) {
		const lista = grupos.get(campo.grupo);
		if (lista) lista.push(campo);
		else grupos.set(campo.grupo, [campo]);
	}
	return grupos;
}
