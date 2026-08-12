import { ItemView, Menu, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { No, NoPasta, caminhosDePastas, filtrar, montarArvore } from "./arvore";
import { formatoDe } from "./documento";
import type VisualEditorPlugin from "./main";
import { TIPO_VISTA_VISUAL } from "./vista-visual";

export const TIPO_EXPLORADOR = "visual-editor-explorador";

/**
 * O explorador lateral: as pastas do vault que têm arquivos editáveis, e só elas.
 *
 * Existe por dois motivos que ela levantou na mesma frase. O primeiro é achar os arquivos: o painel
 * nativo mostra o vault inteiro, e num vault que é sobretudo notas os poucos `.css` de projeto se
 * perdem. O segundo é maior — *"eu nem lembro como é que abre o modo de editor"*. O caminho existia
 * só no menu "..." da aba, escondido. Aqui ele é um ícone no ribbon e um clique no arquivo.
 *
 * É um painel NOVO, ao lado do explorador nativo, não uma substituição: trocar o painel do Obsidian
 * exige mexer na interface interna dele, que muda sem aviso a cada versão.
 */
export class ExploradorVisual extends ItemView {
	/** Pastas abertas, por caminho. É navegação, não configuração — vive na view. */
	private abertas = new Set<string>();
	private busca = "";

	/**
	 * Onde a árvore é desenhada, separado da barra de busca de propósito: redesenhar esvazia este
	 * container, e um `<input>` aqui dentro seria destruído a cada tecla — levando o foco junto.
	 */
	private arvoreEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private plugin: VisualEditorPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return TIPO_EXPLORADOR;
	}

	getDisplayText(): string {
		return "Editor visual";
	}

	getIcon(): string {
		return "sliders-horizontal";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("visual-editor-explorador");

		this.desenharBarra(this.contentEl);
		this.arvoreEl = this.contentEl.createDiv({ cls: "ve-exp-arvore" });
		this.desenhar();

		// A árvore depende de quais arquivos existem, então segue os eventos do vault. Sem debounce,
		// copiar uma pasta de projeto para dentro do vault remontaria a árvore uma vez por arquivo.
		const redesenhar = debounce(() => this.desenhar(), 300, true);
		this.registerEvent(this.app.vault.on("create", redesenhar));
		this.registerEvent(this.app.vault.on("delete", redesenhar));
		this.registerEvent(this.app.vault.on("rename", redesenhar));

		// Marcar o arquivo aberto sem remontar a árvore — só troca a classe da linha.
		this.registerEvent(this.app.workspace.on("file-open", () => this.marcarAtivo()));
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
		// Solta a referência: um evento em atraso desenharia sobre um elemento já destacado do DOM.
		this.arvoreEl = undefined as unknown as HTMLElement;
	}

	/** Um arquivo que o editor visual sabe abrir, conforme as extensões ligadas. */
	private ehEditavel = (arquivo: TFile): boolean => {
		return this.plugin.extensoesAtivas().includes(arquivo.extension.toLowerCase());
	};

	public desenhar(): void {
		// Pode chegar um evento do vault antes de `onOpen` montar o container.
		if (!this.arvoreEl) return;

		const scroll = this.arvoreEl.scrollTop;
		this.arvoreEl.empty();

		const ativas = this.plugin.extensoesAtivas();
		if (ativas.length === 0) {
			this.desenharAviso(
				"Nenhum tipo de arquivo ligado",
				"Abra as configurações do Visual Editor e escolha quais arquivos o editor abre."
			);
			return;
		}

		const raiz = montarArvore(this.app.vault, this.ehEditavel);

		if (raiz.quantos === 0) {
			this.desenharAviso(
				"Nenhum arquivo para editar",
				`Não há arquivos ${ativas.map((e) => `.${e}`).join(", ")} neste cofre. Os tipos ligados ficam nas configurações.`
			);
			return;
		}

		const visivel = filtrar(raiz, this.busca);
		if (!visivel || visivel.tipo !== "pasta" || visivel.filhos.length === 0) {
			this.arvoreEl.createDiv({
				cls: "ve-exp-vazio",
				text: `Nada encontrado para "${this.busca.trim()}".`,
			});
			return;
		}

		// Durante a busca tudo nasce aberto: obrigar a abrir pasta por pasta até o acerto anularia o
		// motivo de ter buscado.
		if (this.busca.trim()) {
			for (const caminho of caminhosDePastas(visivel)) this.abertas.add(caminho);
		}

		const lista = this.arvoreEl.createDiv({ cls: "ve-exp-lista" });
		// A raiz do vault não vira linha: ela não é uma pasta que faça sentido recolher.
		for (const filho of visivel.filhos) this.desenharNo(lista, filho, 0);

		this.arvoreEl.scrollTop = scroll;
		this.marcarAtivo();
	}

	private desenharAviso(titulo: string, texto: string): void {
		const caixa = this.arvoreEl.createDiv({ cls: "ve-exp-aviso" });
		setIcon(caixa.createDiv({ cls: "ve-exp-aviso-icone" }), "sliders-horizontal");
		caixa.createDiv({ cls: "ve-exp-aviso-titulo", text: titulo });
		caixa.createDiv({ cls: "ve-exp-aviso-texto", text: texto });
	}

	private desenharBarra(pai: HTMLElement): void {
		const barra = pai.createDiv({ cls: "ve-exp-barra" });

		const campo = barra.createEl("input", {
			cls: "ve-exp-busca",
			attr: { type: "search", placeholder: "Filtrar arquivos…", value: this.busca },
		});

		const aplicar = debounce(
			() => {
				this.busca = campo.value;
				this.desenhar();
			},
			250,
			false
		);
		campo.addEventListener("input", aplicar);

		const botao = barra.createEl("button", {
			cls: "ve-exp-botao",
			attr: { type: "button", "aria-label": "Recolher tudo" },
		});
		setIcon(botao, "chevrons-down-up");
		botao.addEventListener("click", () => {
			this.abertas.clear();
			this.busca = "";
			campo.value = "";
			this.desenhar();
		});
	}

	private desenharNo(pai: HTMLElement, no: No, nivel: number): void {
		if (no.tipo === "pasta") this.desenharPasta(pai, no, nivel);
		else this.desenharArquivo(pai, no, nivel);
	}

	private desenharPasta(pai: HTMLElement, no: NoPasta, nivel: number): void {
		const aberta = this.abertas.has(no.caminho);

		const linha = pai.createDiv({ cls: "ve-exp-linha ve-exp-pasta" });
		// A indentação é margem interna, não margem externa: assim a faixa de destaque do hover
		// atravessa o painel inteiro, como no explorador nativo.
		linha.style.paddingLeft = `${nivel * 1.1 + 0.4}em`;
		linha.setAttr("role", "button");
		linha.setAttr("tabindex", "0");
		linha.setAttr("aria-expanded", String(aberta));

		const seta = linha.createDiv({ cls: "ve-exp-seta" });
		setIcon(seta, "chevron-right");
		seta.toggleClass("is-aberta", aberta);

		const icone = linha.createDiv({ cls: "ve-exp-icone" });
		setIcon(icone, aberta ? "folder-open" : "folder");

		linha.createSpan({ cls: "ve-exp-nome", text: no.nome });
		// A contagem é o que dá noção do peso da pasta antes de abrir.
		linha.createSpan({ cls: "ve-exp-contagem", text: String(no.quantos) });

		const alternar = () => {
			if (this.abertas.has(no.caminho)) this.abertas.delete(no.caminho);
			else this.abertas.add(no.caminho);
			this.desenhar();
		};

		linha.addEventListener("click", alternar);
		linha.addEventListener("keydown", (evento) => {
			if (evento.key === "Enter" || evento.key === " ") {
				evento.preventDefault();
				alternar();
			}
		});

		if (!aberta) return;

		for (const filho of no.filhos) this.desenharNo(pai, filho, nivel + 1);
	}

	private desenharArquivo(pai: HTMLElement, no: Extract<No, { tipo: "arquivo" }>, nivel: number): void {
		const linha = pai.createDiv({ cls: "ve-exp-linha ve-exp-arquivo" });
		linha.style.paddingLeft = `${nivel * 1.1 + 0.4}em`;
		linha.setAttr("data-caminho", no.caminho);
		linha.setAttr("role", "button");
		linha.setAttr("tabindex", "0");

		const icone = linha.createDiv({ cls: "ve-exp-icone" });
		setIcon(icone, iconeDoArquivo(no.arquivo));

		// O nome sem a extensão, com a extensão como etiqueta à direita: numa lista de `.css` o
		// sufixo repetido em toda linha é ruído, mas ele importa quando há formatos misturados.
		linha.createSpan({ cls: "ve-exp-nome", text: no.arquivo.basename });
		linha.createSpan({ cls: "ve-exp-ext", text: no.arquivo.extension });

		linha.addEventListener("click", () => void this.abrirNoEditor(no.arquivo));
		linha.addEventListener("keydown", (evento) => {
			if (evento.key === "Enter" || evento.key === " ") {
				evento.preventDefault();
				void this.abrirNoEditor(no.arquivo);
			}
		});

		linha.addEventListener("contextmenu", (evento) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Abrir no editor visual")
					.setIcon("sliders-horizontal")
					.onClick(() => void this.abrirNoEditor(no.arquivo))
			);
			menu.addItem((item) =>
				item
					.setTitle("Abrir como código")
					.setIcon("code")
					.onClick(() => void this.abrirComoCodigo(no.arquivo))
			);
			menu.addSeparator();
			// O menu nativo dá "revelar no explorador", renomear, mover — nada disso vale a pena
			// reimplementar aqui.
			this.app.workspace.trigger("file-menu", menu, no.arquivo, "visual-editor-explorador");
			menu.showAtMouseEvent(evento);
		});
	}

	/**
	 * Abre o arquivo já na interface de controles.
	 *
	 * Clicar num arquivo AQUI significa "quero mexer nos controles" — a lista só tem arquivos
	 * editáveis, e foi o botão do ribbon que a trouxe até aqui. A configuração "abrir direto na
	 * interface" continua valendo só para o explorador nativo, onde clicar num arquivo de código
	 * ainda pode significar "quero ver o código".
	 */
	private async abrirNoEditor(arquivo: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({
			type: TIPO_VISTA_VISUAL,
			state: { file: arquivo.path },
			active: true,
		});
		this.marcarAtivo();
	}

	private async abrirComoCodigo(arquivo: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({ type: "markdown", state: { file: arquivo.path }, active: true });
	}

	/** Marca a linha do arquivo aberto, sem remontar a árvore. */
	private marcarAtivo(): void {
		if (!this.arvoreEl) return;

		const ativo = this.app.workspace.getActiveFile()?.path;
		for (const linha of Array.from(this.arvoreEl.querySelectorAll(".ve-exp-arquivo"))) {
			if (!(linha instanceof HTMLElement)) continue;
			linha.toggleClass("is-ativo", linha.getAttr("data-caminho") === ativo);
		}
	}
}

/** O ícone do arquivo pelo formato — dá para distinguir um `.css` de um `.json` de relance. */
function iconeDoArquivo(arquivo: TFile): string {
	switch (formatoDe(arquivo.extension)) {
		case "css":
			return "palette";
		case "json":
			return "braces";
		default:
			return "file-text";
	}
}
