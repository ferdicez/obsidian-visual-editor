import { Plugin } from "obsidian";

export interface ConfiguracoesVisualEditor {
	/**
	 * Extensões que o plugin abre, separadas por vírgula.
	 *
	 * Começa só com `css` de propósito: um vault do Obsidian tem `.json` de configuração por toda
	 * parte (inclusive os do próprio app), e abrir todos eles numa interface de controles seria
	 * ruído. Ela liga o que quiser.
	 */
	extensoes: string;

	/**
	 * Ao clicar num arquivo desses, abre direto na interface visual?
	 *
	 * Desligado por padrão: o gesto de clicar num arquivo de código espera código. A interface vem
	 * pelo botão de alternar, que é o que ela escolheu na conversa de desenho.
	 */
	abrirNaInterface: boolean;
}

export const CONFIGURACOES_PADRAO: ConfiguracoesVisualEditor = {
	extensoes: "css",
	abrirNaInterface: false,
};

export async function carregarConfiguracoes(plugin: Plugin): Promise<ConfiguracoesVisualEditor> {
	const salvas = (await plugin.loadData()) as Partial<ConfiguracoesVisualEditor> | null;
	// Espalhar sobre o padrão em vez de substituir: um `data.json` gravado por uma versão antiga não
	// tem as chaves novas, e sem isto elas viriam `undefined`.
	return { ...CONFIGURACOES_PADRAO, ...(salvas ?? {}) };
}

export async function salvarConfiguracoes(
	plugin: Plugin,
	configuracoes: ConfiguracoesVisualEditor
): Promise<void> {
	await plugin.saveData(configuracoes);
}
