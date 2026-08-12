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

/**
 * Como a tela é dividida em seções. A escolha é dela, na barra da view.
 *
 * Nenhum dos três é certo sempre: um `global.css` bem comentado fica ótimo em "secao", um sem
 * comentário nenhum só se organiza por "prefixo", e "estrutura" é o único que mostra a verdade
 * quando a mesma variável aparece em contextos diferentes (tema escuro, media query).
 */
export type ModoAgrupamento = "secao" | "prefixo" | "estrutura";

/** Onde caem os campos que o modo escolhido não sabe classificar. */
const SEM_GRUPO = "Outros";

/**
 * O modo faz sentido para estes campos?
 *
 * Serve para a barra não oferecer uma opção que resultaria numa tela pior: agrupar por seção um
 * arquivo sem nenhum comentário de seção jogaria tudo em "Outros", e ela ficaria achando que o
 * plugin quebrou. A opção some em vez de mentir.
 */
export function modoDisponivel(campos: Campo[], modo: ModoAgrupamento): boolean {
	switch (modo) {
		case "secao":
			return campos.some((campo) => campo.secao);
		case "prefixo":
			return campos.some((campo) => campo.prefixo);
		case "estrutura":
			return true;
	}
}

/** Agrupa os campos na ordem em que os grupos aparecem, para a interface desenhar seções. */
export function agrupar(campos: Campo[], modo: ModoAgrupamento = "estrutura"): Map<string, Campo[]> {
	const grupos = new Map<string, Campo[]>();

	for (const campo of campos) {
		const nome = nomeDoGrupo(campo, modo);
		const lista = grupos.get(nome);
		if (lista) lista.push(campo);
		else grupos.set(nome, [campo]);
	}

	// "Outros" vai para o fim: é a sobra, e ela não deve abrir a tela olhando para a sobra.
	const sobra = grupos.get(SEM_GRUPO);
	if (sobra && grupos.size > 1) {
		grupos.delete(SEM_GRUPO);
		grupos.set(SEM_GRUPO, sobra);
	}

	return grupos;
}

function nomeDoGrupo(campo: Campo, modo: ModoAgrupamento): string {
	switch (modo) {
		case "secao":
			return campo.secao ?? SEM_GRUPO;
		case "prefixo":
			return campo.prefixo ?? SEM_GRUPO;
		case "estrutura":
			return campo.grupo;
	}
}
