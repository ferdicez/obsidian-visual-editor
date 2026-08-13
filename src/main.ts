import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
	CONFIGURACOES_PADRAO,
	ConfiguracoesVisualEditor,
	carregarConfiguracoes,
	salvarConfiguracoes,
} from "./configuracoes";
import { formatoDe } from "./documento";
import { ExploradorVisual, TIPO_EXPLORADOR } from "./explorador";
import { ModalNovoArquivo } from "./modal-novo-arquivo";
import { PainelConfigVisualEditor } from "./painel-config";
import { TIPO_VISTA_VISUAL, VistaVisual } from "./vista-visual";

export default class VisualEditorPlugin extends Plugin {
	configuracoes: ConfiguracoesVisualEditor = { ...CONFIGURACOES_PADRAO };

	async onload() {
		this.configuracoes = await carregarConfiguracoes(this);
		this.addSettingTab(new PainelConfigVisualEditor(this.app, this));

		this.registerView(TIPO_VISTA_VISUAL, (leaf) => new VistaVisual(leaf, this));
		this.registerView(TIPO_EXPLORADOR, (leaf) => new ExploradorVisual(leaf, this));

		// O ícone no ribbon é o caminho VISÍVEL para o editor.
		//
		// Ele existe por um relato dela: *"eu nem lembro como é que abre o modo de editor"*. Até aqui
		// o único caminho era o menu "..." da aba — invisível para quem não sabe que ele está lá.
		// Agora o gesto é: clicar no ícone, ver as pastas que têm arquivos editáveis, clicar no
		// arquivo. O menu da aba e o comando continuam, para quem já está com o arquivo aberto.
		this.addRibbonIcon("sliders-horizontal", "Editor visual", () => void this.abrirExplorador());

		this.addCommand({
			id: "abrir-explorador",
			name: "Abrir o explorador do editor visual",
			callback: () => void this.abrirExplorador(),
		});

		this.addCommand({
			id: "criar-design-system",
			name: "Criar arquivo de Design System",
			callback: () => this.abrirModalNovoDesignSystem(),
		});

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

		// Desfazer e refazer também como comandos: a paleta os alcança, e ela pode remapear as teclas
		// se preferir outro atalho.
		this.addCommand({
			id: "desfazer-editor-visual",
			name: "Desfazer no editor visual",
			checkCallback: (apenasVerificar) => {
				const view = this.app.workspace.getActiveViewOfType(VistaVisual);
				if (!view) return false;
				if (apenasVerificar) return true;
				view.desfazer();
				return true;
			},
		});

		this.addCommand({
			id: "refazer-editor-visual",
			name: "Refazer no editor visual",
			checkCallback: (apenasVerificar) => {
				const view = this.app.workspace.getActiveViewOfType(VistaVisual);
				if (!view) return false;
				if (apenasVerificar) return true;
				view.refazer();
				return true;
			},
		});

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
		//
		// As leaves do explorador também não são fechadas de propósito: o Obsidian as descarta
		// sozinho, e fechá-las aqui apagaria o painel do layout salvo dela — ao reativar o plugin,
		// sumiria.
	}

	/** Abre (ou revela) o explorador na barra lateral esquerda. */
	private async abrirExplorador(): Promise<void> {
		const existentes = this.app.workspace.getLeavesOfType(TIPO_EXPLORADOR);
		if (existentes.length > 0) {
			this.app.workspace.revealLeaf(existentes[0]);
			return;
		}

		const leaf = this.app.workspace.getLeftLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: TIPO_EXPLORADOR, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Abre o modal que pergunta pasta e nome, e cria o arquivo em seguida.
	 *
	 * Existe porque a aba Design System só aparece dentro de um CSS que já está aberto — sem um
	 * atalho que cria o arquivo, ela precisaria montar um `.css` com `:root {}` na mão antes de ver a
	 * aba pela primeira vez.
	 */
	abrirModalNovoDesignSystem(): void {
		new ModalNovoArquivo(this.app, "design-system", (caminho) => void this.criarArquivoDesignSystem(caminho)).open();
	}

	/**
	 * Cria o arquivo com um `:root` vazio e já abre no editor visual, na aba Design System.
	 *
	 * O `:root` não é opcional: `declararVariavel` (ver `extrair.ts`) recusa criar token sem um
	 * `:root`/`@theme` já existente no arquivo — nascer sem ele faria o primeiro clique na aba nova
	 * falhar com um erro que não faria sentido pra quem acabou de criar o arquivo justamente pra isso.
	 */
	private async criarArquivoDesignSystem(caminho: string): Promise<void> {
		let arquivo: TFile;
		try {
			arquivo = await this.app.vault.create(caminho, ":root {\n}\n");
		} catch (erro) {
			new Notice(`Não foi possível criar o arquivo: ${erro instanceof Error ? erro.message : erro}`);
			return;
		}

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({
			type: TIPO_VISTA_VISUAL,
			state: { file: arquivo.path },
			active: true,
		});

		const view = leaf.view;
		if (view instanceof VistaVisual) view.abrirAbaDesignSystem();
	}

	/** Redesenha os exploradores abertos — chamado quando as extensões ligadas mudam. */
	atualizarExploradores(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TIPO_EXPLORADOR)) {
			const view = leaf.view;
			if (view instanceof ExploradorVisual) view.desenhar();
		}
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
