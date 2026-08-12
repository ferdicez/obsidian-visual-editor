import { Plugin } from "obsidian";
import type { ModoAgrupamento } from "./documento";

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

	/**
	 * Como as seções da tela são formadas. Ela troca na barra da view, não no painel.
	 *
	 * Fica guardado aqui porque é preferência, não estado do arquivo: escolher "por seção" num
	 * `global.css` e reabrir no dia seguinte no modo antigo seria trabalho repetido. O padrão é
	 * "secao" — quando o arquivo tem cabeçalhos, é o agrupamento que ela mesma escreveu; quando não
	 * tem, a view cai para o próximo modo disponível sozinha.
	 */
	agrupamento: ModoAgrupamento;

	/**
	 * Mostrar a aba "Elementos" (as regras `.card { … }`), além dos tokens?
	 *
	 * Ligado por padrão: foi o que ela pediu — ver que variável cada elemento usa e poder atribuir.
	 * Desligar devolve o plugin ao comportamento de só tokens, para um arquivo onde as regras são
	 * ruído. As regras nunca são reescritas por estarem à vista; só o que ela editar.
	 */
	mostrarElementos: boolean;
}

export const CONFIGURACOES_PADRAO: ConfiguracoesVisualEditor = {
	extensoes: "css",
	abrirNaInterface: false,
	agrupamento: "secao",
	mostrarElementos: true,
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
