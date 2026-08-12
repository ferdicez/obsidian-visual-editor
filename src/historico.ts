/**
 * O histórico de desfazer/refazer da view visual.
 *
 * **Por que existe:** o Ctrl+Z do Obsidian pertence ao editor de texto (CodeMirror). A view visual
 * não é um editor de texto — é uma tela de controles que reescreve o arquivo direto —, então não há
 * histórico nenhum para ele desfazer. Ela relatou que "o ctrl z não funciona", e a causa é essa:
 * não é que o atalho esteja quebrado, é que não havia nada gravado.
 *
 * Guarda o texto INTEIRO a cada passo, não um diff. Um `global.css` tem alguns KB e o limite é de
 * poucas dezenas de passos: o custo total fica na casa de centenas de KB, e em troca desfazer é
 * exato — sem risco de um diff mal aplicado corromper o arquivo, que é o oposto do que a promessa
 * do plugin permite.
 */

export interface PassoHistorico {
	texto: string;
	/** O que a ação fez, para o botão dizer "Desfazer: cor primária". */
	rotulo: string;
}

/**
 * Quantos passos guardar.
 *
 * Fundo o bastante para cobrir uma sessão de ajustes (arrastar meia dúzia de sliders, testar três
 * cores), raso o bastante para a memória não crescer sem limite num arquivo grande.
 */
const LIMITE = 50;

export class Historico {
	private passos: PassoHistorico[] = [];
	/** Onde estamos na pilha. -1 significa "nada registrado ainda". */
	private posicao = -1;

	/**
	 * Registra o estado INICIAL do arquivo.
	 *
	 * É o passo zero, e sem ele o primeiro desfazer não teria para onde voltar. Chamado ao abrir o
	 * arquivo e quando ele muda no disco por fora.
	 */
	iniciar(texto: string): void {
		this.passos = [{ texto, rotulo: "Estado inicial" }];
		this.posicao = 0;
	}

	/**
	 * Registra uma mudança.
	 *
	 * Se ela desfez alguns passos e depois editou, o "futuro" que estava à frente é descartado — é o
	 * comportamento de qualquer editor, e manter os dois ramos exigiria uma árvore que ninguém pediu.
	 */
	registrar(texto: string, rotulo: string): void {
		// Nada mudou: não registra. Um controle que dispara `change` sem alterar o valor (soltar o
		// slider no mesmo lugar) encheria a pilha de passos que não desfazem nada.
		if (this.posicao >= 0 && this.passos[this.posicao].texto === texto) return;

		this.passos = this.passos.slice(0, this.posicao + 1);
		this.passos.push({ texto, rotulo });

		if (this.passos.length > LIMITE) {
			this.passos.shift();
		}

		this.posicao = this.passos.length - 1;
	}

	/** Volta um passo e devolve o texto de destino. Null quando não há o que desfazer. */
	desfazer(): PassoHistorico | null {
		if (!this.podeDesfazer) return null;
		this.posicao--;
		return this.passos[this.posicao];
	}

	/** Avança um passo. Null quando não há o que refazer. */
	refazer(): PassoHistorico | null {
		if (!this.podeRefazer) return null;
		this.posicao++;
		return this.passos[this.posicao];
	}

	get podeDesfazer(): boolean {
		return this.posicao > 0;
	}

	get podeRefazer(): boolean {
		return this.posicao >= 0 && this.posicao < this.passos.length - 1;
	}

	/** O rótulo da ação que o desfazer vai reverter, para o botão dizer o que faz. */
	get rotuloDesfazer(): string | null {
		if (!this.podeDesfazer) return null;
		return this.passos[this.posicao].rotulo;
	}

	get rotuloRefazer(): string | null {
		if (!this.podeRefazer) return null;
		return this.passos[this.posicao + 1].rotulo;
	}

	/**
	 * O texto no ponto atual — para comparar com o que chegou do disco.
	 *
	 * Quando o arquivo muda por fora (o editor de código dela, o git), o histórico daqui não vale
	 * mais: os passos descreveriam um arquivo que não existe.
	 */
	get atual(): string | null {
		return this.posicao >= 0 ? this.passos[this.posicao].texto : null;
	}
}
