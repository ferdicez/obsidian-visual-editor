import { App, PluginSettingTab, Setting } from "obsidian";
import { Formato, extensoesSuportadas } from "./documento";
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

	/**
	 * Os tipos de arquivo, como fichas clicáveis.
	 *
	 * Era um campo de texto separado por vírgula: para ligar o `.json` ela precisava saber que ele
	 * existe (a lista estava só na descrição) e digitar sem errar. Clicar é o gesto certo para
	 * escolher de um conjunto fechado — e o conjunto é pequeno e conhecido pelo plugin.
	 */
	private montarExtensoes(): void {
		const ativas = new Set(this.plugin.extensoesAtivas());

		new Setting(this.containerEl)
			.setName("Tipos de arquivo")
			.setDesc("Quais arquivos o editor visual passa a abrir. Clique para ligar ou desligar.")
			.addExtraButton((botao) =>
				botao
					.setIcon("check-check")
					.setTooltip("Ligar todos")
					.onClick(() => {
						const todas = extensoesSuportadas().flatMap((grupo) => grupo.extensoes);
						void this.gravarExtensoes(todas);
					})
			);

		const grade = this.containerEl.createDiv({ cls: "visual-editor-config-tipos" });

		// Rótulo por formato: agrupar deixa claro que `.env`/`.ini` são lidos como texto simples, e
		// não como um formato próprio que o plugin entenderia melhor.
		const nomes: Record<Formato, string> = {
			css: "Folhas de estilo",
			json: "JSON",
			texto: "Texto simples",
		};

		for (const { formato, extensoes } of extensoesSuportadas()) {
			const grupo = grade.createDiv({ cls: "visual-editor-config-grupo" });
			grupo.createDiv({ cls: "visual-editor-config-grupo-nome", text: nomes[formato] });

			const fichas = grupo.createDiv({ cls: "visual-editor-config-fichas" });

			for (const extensao of extensoes) {
				const ligada = ativas.has(extensao);

				const ficha = fichas.createEl("button", {
					cls: "visual-editor-config-ficha",
					attr: { type: "button", "aria-pressed": String(ligada) },
				});
				ficha.setText(`.${extensao}`);
				ficha.toggleClass("is-ligada", ligada);

				ficha.addEventListener("click", () => {
					const novas = new Set(ativas);
					if (novas.has(extensao)) novas.delete(extensao);
					else novas.add(extensao);
					void this.gravarExtensoes([...novas]);
				});
			}
		}

		if (ativas.size === 0) {
			this.containerEl.createDiv({
				cls: "visual-editor-config-vazio",
				text: "Nenhum tipo de arquivo ligado — o editor visual não vai abrir nada.",
			});
		}

		new Setting(this.containerEl)
			.setName("Esconder arquivos de máquina")
			.setDesc(
				"No explorador lateral, ignora node_modules, dist, .git e arquivos como package.json e tsconfig.json — o que mora neles é de biblioteca ou gerado pelo build, e editar ali é desfeito na próxima compilação."
			)
			.addToggle((alternador) =>
				alternador
					.setValue(this.plugin.configuracoes.esconderArquivosDeMaquina)
					.onChange(async (valor) => {
						this.plugin.configuracoes.esconderArquivosDeMaquina = valor;
						await this.plugin.salvarConfiguracoes();
						this.plugin.atualizarExploradores();
					})
			);

		// O Obsidian só aplica `registerExtensions` no carregamento do plugin: mudar a lista aqui não
		// tem efeito até o próximo reinício. Avisar é melhor do que ela mexer e achar que quebrou.
		this.containerEl.createDiv({
			cls: "visual-editor-config-nota",
			text: "Mudanças nesta lista valem depois de reiniciar o Obsidian (ou desativar e reativar o plugin).",
		});
	}

	/**
	 * Grava a lista de extensões e redesenha o painel.
	 *
	 * A ordem é a canônica do plugin, não a de clique: sem isto a lista embaralharia a cada toque, e
	 * a string gravada em `data.json` mudaria de forma sem mudar de significado.
	 */
	private async gravarExtensoes(extensoes: string[]): Promise<void> {
		const canonica = extensoesSuportadas()
			.flatMap((grupo) => grupo.extensoes)
			.filter((extensao) => extensoes.includes(extensao));

		this.plugin.configuracoes.extensoes = canonica.join(", ");
		await this.plugin.salvarConfiguracoes();

		// O explorador lista os arquivos por extensão: ligar `.json` aqui tem de fazer os `.json`
		// aparecerem na barra lateral na hora. (Abrir os arquivos ainda pede reinício — é o
		// `registerExtensions` que só vale no carregamento, e a nota abaixo avisa disso.)
		this.plugin.atualizarExploradores();

		this.display();
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

		// Sem isto, fechar a orientação no `×` seria irreversível — e ela some para sempre, então
		// não haveria como reaprender a diferença entre token e elemento.
		new Setting(this.containerEl)
			.setName("Mostrar as explicações")
			.setDesc(
				"A linha com o lampadinha no topo de cada lista, explicando o que são tokens e elementos. Some quando você fecha no ×; ligue aqui para trazê-la de volta."
			)
			.addToggle((alternador) =>
				alternador
					.setValue(!this.plugin.configuracoes.esconderOrientacao)
					.onChange(async (valor) => {
						this.plugin.configuracoes.esconderOrientacao = !valor;
						await this.plugin.salvarConfiguracoes();
					})
			);

		this.containerEl.createDiv({
			cls: "visual-editor-config-nota",
			text: "Extrair para variável é a única ação do plugin que acrescenta linha ao arquivo: ela cria a declaração no bloco de tokens (:root, ou @theme no Tailwind) e troca o valor da regra por var(--nome). Todo o resto só reescreve o valor que você editou.",
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
