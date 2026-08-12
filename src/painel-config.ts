import { App, PluginSettingTab, Setting } from "obsidian";
import type VisualEditorPlugin from "./main";

/**
 * Painel de configurações. Um assunto só (que arquivos o editor visual abre), então é lista
 * simples — a barra de abas da especificação só entra quando houver dois assuntos.
 * Ver `plugins/_docs/painel-de-configuracoes.md`.
 */
export class PainelConfigVisualEditor extends PluginSettingTab {
	constructor(app: App, private plugin: VisualEditorPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		// O scroll é devolvido no fim: redesenhar o painel inteiro o jogaria para o topo
		// a cada mudança, e ela perderia o lugar onde estava mexendo.
		const scrollAnterior = containerEl.scrollTop;

		containerEl.empty();
		containerEl.addClass("visual-editor-config");

		this.montarExtensoes();
		this.montarAbertura();
		this.montarElementos();

		containerEl.scrollTop = scrollAnterior;
	}

	private montarExtensoes(): void {
		const config = this.plugin.configuracoes;

		new Setting(this.containerEl)
			.setName("Tipos de arquivo")
			.setDesc(
				"Extensões que o editor visual passa a abrir, separadas por vírgula. Aceita css, scss, sass, less, json, jsonc, txt, env, ini, properties e conf."
			)
			.addText((campo) =>
				campo
					.setPlaceholder("css, json")
					.setValue(config.extensoes)
					.onChange(async (valor) => {
						this.plugin.configuracoes.extensoes = valor;
						await this.plugin.salvarConfiguracoes();
					})
			);

		const ativas = this.plugin.extensoesAtivas();

		if (ativas.length === 0) {
			this.containerEl.createDiv({
				cls: "visual-editor-config-vazio",
				text: "Nenhuma extensão reconhecida ainda.",
			});
		}

		// O Obsidian só aplica `registerExtensions` no carregamento do plugin: mudar a lista aqui não
		// tem efeito até o próximo reinício. Avisar é melhor do que ela mexer e achar que quebrou.
		this.containerEl.createDiv({
			cls: "visual-editor-config-nota",
			text: "Mudanças nesta lista valem depois de reiniciar o Obsidian (ou desativar e reativar o plugin).",
		});
	}

	/**
	 * A aba "Elementos" — as regras `.card { … }` além dos tokens.
	 *
	 * Configurável porque a utilidade depende do arquivo: num `tokens.css` puro não há regra nenhuma
	 * e a opção não muda nada, mas num CSS de página as regras podem ser o que ela quer ver — ou
	 * ruído, se ela só foi ali ajustar uma cor.
	 */
	private montarElementos(): void {
		const config = this.plugin.configuracoes;

		new Setting(this.containerEl)
			.setName("Mostrar os elementos")
			.setDesc(
				"Ligado, o editor ganha a aba “Elementos” com as regras do arquivo (.card, .botao) — dá para ver que variável cada uma usa, trocar por outra ou extrair um valor para variável nova. Desligado, só os tokens aparecem."
			)
			.addToggle((alternador) =>
				alternador.setValue(config.mostrarElementos).onChange(async (valor) => {
					this.plugin.configuracoes.mostrarElementos = valor;
					await this.plugin.salvarConfiguracoes();
				})
			);

		this.containerEl.createDiv({
			cls: "visual-editor-config-nota",
			text: "Extrair para variável é a única ação do plugin que acrescenta linha ao arquivo: ela cria a declaração no :root e troca o valor da regra por var(--nome). Todo o resto só reescreve o valor que você editou.",
		});
	}

	private montarAbertura(): void {
		const config = this.plugin.configuracoes;

		new Setting(this.containerEl)
			.setName("Abrir direto na interface")
			.setDesc(
				"Ligado, clicar num arquivo desses tipos já mostra os controles. Desligado, ele abre como código e você alterna pelo menu da aba ou pelo comando “Alternar entre editor visual e código”."
			)
			.addToggle((alternador) =>
				alternador.setValue(config.abrirNaInterface).onChange(async (valor) => {
					this.plugin.configuracoes.abrirNaInterface = valor;
					await this.plugin.salvarConfiguracoes();
				})
			);
	}
}
