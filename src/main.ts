import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
	CONFIGURACOES_PADRAO,
	ConfiguracoesVisualEditor,
	carregarConfiguracoes,
	salvarConfiguracoes,
} from "./configuracoes";
import { formatoDe } from "./documento";
import { PainelConfigVisualEditor } from "./painel-config";
import { TIPO_VISTA_VISUAL, VistaVisual } from "./vista-visual";

export default class VisualEditorPlugin extends Plugin {
	configuracoes: ConfiguracoesVisualEditor = { ...CONFIGURACOES_PADRAO };

	async onload() {
		this.configuracoes = await carregarConfiguracoes(this);
		this.addSettingTab(new PainelConfigVisualEditor(this.app, this));

		this.registerView(TIPO_VISTA_VISUAL, (leaf) => new VistaVisual(leaf, this));

		// Sem isto, um .css/.json/.txt não abriria de jeito nenhum: o Obsidian só sabe abrir as
		// extensões que conhece (md, canvas…) e ignora o resto. Registrar aqui faz o arquivo abrir —
		// nesta view ou na de texto, conforme a preferência dela.
		this.registrarExtensoes();

		// O botão que alterna entre código e interface, no menu "..." da aba.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, arquivo, _origem, leaf) => {
				if (!(arquivo instanceof TFile)) return;
				if (!formatoDe(arquivo.extension)) return;

				const naVisual = leaf?.view.getViewType() === TIPO_VISTA_VISUAL;

				menu.addItem((item) =>
					item
						.setTitle(naVisual ? "Abrir como código" : "Abrir no editor visual")
						.setIcon(naVisual ? "code" : "sliders-horizontal")
						.onClick(() => this.alternar(leaf ?? null, arquivo))
				);
			})
		);

		this.addCommand({
			id: "alternar-editor-visual",
			name: "Alternar entre editor visual e código",
			checkCallback: (apenasVerificar) => {
				const arquivo = this.app.workspace.getActiveFile();
				if (!arquivo || !formatoDe(arquivo.extension)) return false;
				if (apenasVerificar) return true;

				this.alternar(this.app.workspace.getMostRecentLeaf(), arquivo);
				return true;
			},
		});
	}

	onunload() {
		// As extensões registradas são desfeitas pelo próprio Obsidian ao descarregar o plugin.
	}

	async salvarConfiguracoes(): Promise<void> {
		await salvarConfiguracoes(this, this.configuracoes);
	}

	/**
	 * Registra as extensões que o plugin passa a abrir.
	 *
	 * A view de destino depende da preferência: com "abrir na interface" ligado, o arquivo já cai
	 * nos controles; desligado, abre como texto e ela usa o botão quando quiser. Em ambos os casos
	 * o alternar continua funcionando.
	 *
	 * O try/catch existe porque `registerExtensions` estoura se outro plugin já tiver reivindicado
	 * a mesma extensão. Nesse caso o certo é não derrubar o carregamento — o Obsidian abre o
	 * arquivo pelo outro plugin, e o comando de alternar continua disponível.
	 */
	private registrarExtensoes(): void {
		const extensoes = this.extensoesAtivas();
		if (extensoes.length === 0) return;

		const destino = this.configuracoes.abrirNaInterface ? TIPO_VISTA_VISUAL : "markdown";

		try {
			this.registerExtensions(extensoes, destino);
		} catch (erro) {
			console.warn("[Visual Editor] Não foi possível registrar as extensões:", erro);
		}
	}

	/** As extensões ligadas nas configurações, normalizadas (sem ponto, minúsculas, sem repetição). */
	extensoesAtivas(): string[] {
		const brutas = this.configuracoes.extensoes
			.split(",")
			.map((e) => e.trim().replace(/^\./, "").toLowerCase())
			.filter(Boolean);

		return [...new Set(brutas)].filter((e) => formatoDe(e) !== null);
	}

	/**
	 * Troca a view do arquivo entre visual e código, na mesma aba.
	 *
	 * `setViewState` na própria leaf preserva a posição dela no layout — abrir em aba nova
	 * duplicaria o arquivo e deixaria duas versões do mesmo conteúdo abertas, que é justamente
	 * onde se perde edição.
	 */
	async alternar(leaf: WorkspaceLeaf | null, arquivo: TFile): Promise<void> {
		const alvo = leaf ?? this.app.workspace.getLeaf(false);
		const naVisual = alvo.view.getViewType() === TIPO_VISTA_VISUAL;

		// Salva o que estiver pendente antes de trocar: a view atual é destruída na troca, e
		// qualquer alteração ainda não gravada iria junto.
		if (alvo.view instanceof VistaVisual) {
			await alvo.view.save();
		}

		await alvo.setViewState({
			type: naVisual ? "markdown" : TIPO_VISTA_VISUAL,
			state: { file: arquivo.path },
			active: true,
		});

		if (!naVisual && !formatoDe(arquivo.extension)) {
			new Notice("Este tipo de arquivo não tem editor visual.");
		}
	}
}
