import { Notice, TextFileView, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { botaoIcone, desenharControle } from "./controles";
import { Formato, agrupar, escrever, formatoDe, ler } from "./documento";
import type VisualEditorPlugin from "./main";
import { Campo, humanizar } from "./tipos";

export const TIPO_VISTA_VISUAL = "visual-editor-vista";

/**
 * A view que mostra o arquivo como interface em vez de código.
 *
 * Herda de `TextFileView` porque o conteúdo É o texto do arquivo: o Obsidian cuida de carregar,
 * marcar como sujo e salvar, e o plugin só precisa dizer como desenhar (`setViewData`) e o que
 * gravar (`getViewData`). Reimplementar isso à mão significaria brigar com o ciclo de salvamento
 * do app — que é o caminho mais curto para perder o trabalho dela.
 *
 * O `texto` guardado aqui é sempre o arquivo INTEIRO, incluindo tudo o que a interface não mostra.
 * Editar um controle reescreve só os caracteres daquele valor dentro dele.
 */
export class VistaVisual extends TextFileView {
	private plugin: VisualEditorPlugin;

	/** O conteúdo integral do arquivo — a fonte de verdade. */
	private texto = "";
	private formato: Formato = "css";
	private campos: Campo[] = [];
	private naoEditaveis = 0;

	/** Modo código mostra o texto cru numa textarea, para ela conferir ou editar à mão. */
	private modoCodigo = false;

	private corpo!: HTMLElement;
	private barra!: HTMLElement;
	private filtro = "";

	/**
	 * Salvar é adiado: um arrastar de slider gera muitos `change` seguidos, e cada gravação dispara
	 * o hot reload do dev server dela. 400ms junta a rajada num único salvamento.
	 */
	private salvarAdiado = debounce(() => this.requestSave(), 400, true);

	constructor(leaf: WorkspaceLeaf, plugin: VisualEditorPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TIPO_VISTA_VISUAL;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Editor visual";
	}

	getIcon(): string {
		return "sliders-horizontal";
	}

	/** O que o Obsidian grava no arquivo. É sempre o texto integral. */
	getViewData(): string {
		return this.texto;
	}

	/**
	 * Chamado ao abrir o arquivo e sempre que ele muda no disco.
	 *
	 * `limpar` vem `true` quando é um arquivo novo. Nos dois casos relemos do zero: o arquivo pode
	 * ter sido alterado pelo editor de código dela por fora, e os deslocamentos guardados não
	 * valeriam mais.
	 */
	setViewData(dados: string, _limpar: boolean): void {
		this.texto = dados;
		this.formato = formatoDe(this.file?.extension ?? "") ?? "css";

		const documento = ler(dados, this.formato);
		this.campos = documento.campos;
		this.naoEditaveis = documento.naoEditaveis;

		this.desenhar();
	}

	clear(): void {
		this.texto = "";
		this.campos = [];
		this.naoEditaveis = 0;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("visual-editor-vista");
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	// -------------------------------------------------------------------------------------------
	// Desenho
	// -------------------------------------------------------------------------------------------

	private desenhar(): void {
		// A posição de rolagem é restaurada porque `desenhar()` roda a cada gravação: sem isso, mexer
		// num controle lá embaixo jogaria a tela de volta ao topo a cada ajuste.
		const rolagem = this.corpo?.scrollTop ?? 0;

		this.contentEl.empty();
		this.desenharBarra();

		this.corpo = this.contentEl.createDiv({ cls: "ve-corpo" });

		if (this.modoCodigo) {
			this.desenharCodigo();
		} else {
			this.desenharCampos();
		}

		this.corpo.scrollTop = rolagem;
	}

	private desenharBarra(): void {
		this.barra = this.contentEl.createDiv({ cls: "ve-barra" });

		const esquerda = this.barra.createDiv({ cls: "ve-barra-esquerda" });

		const busca = esquerda.createEl("input", {
			cls: "ve-busca",
			attr: { type: "search", placeholder: "Filtrar…", value: this.filtro },
		});
		busca.addEventListener("input", () => {
			this.filtro = busca.value.trim().toLowerCase();
			// Só a lista é redesenhada: recriar a barra tiraria o foco do campo a cada tecla.
			this.corpo.empty();
			if (this.modoCodigo) this.desenharCodigo();
			else this.desenharCampos();
		});
		if (this.modoCodigo) busca.hide();

		const direita = this.barra.createDiv({ cls: "ve-barra-direita" });

		const contagem = direita.createSpan({ cls: "ve-contagem" });
		contagem.setText(
			this.campos.length === 1 ? "1 controle" : `${this.campos.length} controles`
		);

		botaoIcone(
			direita,
			this.modoCodigo ? "sliders-horizontal" : "code",
			this.modoCodigo ? "Ver como interface" : "Ver o código",
			() => {
				this.modoCodigo = !this.modoCodigo;
				this.desenhar();
			}
		);
	}

	private desenharCampos(): void {
		if (this.campos.length === 0) {
			this.desenharVazio();
			return;
		}

		const visiveis = this.filtro
			? this.campos.filter(
					(campo) =>
						campo.rotulo.toLowerCase().includes(this.filtro) ||
						campo.chave.toLowerCase().includes(this.filtro) ||
						campo.grupo.toLowerCase().includes(this.filtro)
				)
			: this.campos;

		if (visiveis.length === 0) {
			this.corpo.createDiv({
				cls: "ve-vazio",
				text: `Nenhum controle encontrado para "${this.filtro}".`,
			});
			return;
		}

		for (const [grupo, campos] of agrupar(visiveis)) {
			const secao = this.corpo.createDiv({ cls: "ve-secao" });
			secao.createDiv({ cls: "ve-secao-titulo", text: humanizar(grupo) });

			for (const campo of campos) {
				this.desenharCampo(secao, campo);
			}
		}

		if (this.naoEditaveis > 0) {
			const nota = this.corpo.createDiv({ cls: "ve-nota" });
			setIcon(nota.createSpan({ cls: "ve-nota-icone" }), "info");
			nota.createSpan({
				text:
					this.naoEditaveis === 1
						? "Há 1 trecho neste arquivo que a interface não edita — ele fica intacto ao salvar."
						: `Há ${this.naoEditaveis} trechos neste arquivo que a interface não edita — eles ficam intactos ao salvar.`,
			});
		}
	}

	private desenharCampo(pai: HTMLElement, campo: Campo): void {
		const linha = pai.createDiv({ cls: "ve-campo" });

		const rotulo = linha.createDiv({ cls: "ve-campo-rotulo" });
		rotulo.createDiv({ cls: "ve-campo-nome", text: campo.rotulo });
		if (campo.descricao) {
			rotulo.createDiv({ cls: "ve-campo-descricao", text: campo.descricao });
		}
		// O nome real fica no title: o rótulo humanizado é bom para ler, mas na hora de casar com o
		// código ela precisa do nome exato da variável.
		rotulo.setAttr("title", campo.nomeReal);

		desenharControle(linha, campo, (novo) => this.aplicar(campo, novo));
	}

	private desenharVazio(): void {
		const vazio = this.corpo.createDiv({ cls: "ve-vazio-completo" });
		setIcon(vazio.createDiv({ cls: "ve-vazio-icone" }), "sliders-horizontal");

		const explicacao: Record<Formato, string> = {
			css: "Este arquivo não tem variáveis CSS (`--nome: valor`). O editor visual mostra os controles a partir delas — declare as suas num bloco `:root` e elas aparecem aqui.",
			json: "Este arquivo não tem valores que o editor consiga mostrar como controles.",
			texto: "Este arquivo não tem linhas no formato `chave = valor`.",
		};

		vazio.createDiv({ cls: "ve-vazio-titulo", text: "Nenhum controle para mostrar" });
		vazio.createDiv({ cls: "ve-vazio-texto", text: explicacao[this.formato] });
	}

	/**
	 * Modo código: o texto integral numa textarea.
	 *
	 * Existe por confiança — ela pode conferir a qualquer momento que o plugin mexeu só no que devia.
	 * Editar aqui também funciona, e ao sair do campo os controles são relidos do novo texto.
	 */
	private desenharCodigo(): void {
		const area = this.corpo.createEl("textarea", {
			cls: "ve-codigo",
			attr: { spellcheck: "false" },
		});
		area.value = this.texto;

		area.addEventListener("blur", () => {
			if (area.value === this.texto) return;
			this.texto = area.value;

			const documento = ler(this.texto, this.formato);
			this.campos = documento.campos;
			this.naoEditaveis = documento.naoEditaveis;

			this.salvarAdiado();
			this.desenhar();
		});
	}

	// -------------------------------------------------------------------------------------------
	// Edição
	// -------------------------------------------------------------------------------------------

	/**
	 * Aplica um valor novo e agenda o salvamento.
	 *
	 * Depois de reescrever, o arquivo é RELIDO: trocar `8px` por `100px` desloca tudo o que vem
	 * depois, e os `inicio`/`fim` dos outros campos precisam ser recalculados. Sem reler, a segunda
	 * edição da sessão gravaria no lugar errado.
	 */
	private aplicar(campo: Campo, novo: string): void {
		const anterior = this.texto;

		try {
			this.texto = escrever(this.texto, this.campos, new Map([[campo.chave, novo]]), this.formato);
		} catch (erro) {
			this.texto = anterior;
			new Notice(`Não foi possível aplicar a mudança: ${erro instanceof Error ? erro.message : erro}`);
			return;
		}

		const documento = ler(this.texto, this.formato);
		this.campos = documento.campos;
		this.naoEditaveis = documento.naoEditaveis;

		this.salvarAdiado();

		// A tela é redesenhada para os deslocamentos novos valerem nos controles. É barato: são
		// dezenas de elementos, não milhares.
		this.desenhar();
	}
}
