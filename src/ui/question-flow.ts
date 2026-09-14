// 提问流程的状态机
//
// 官方协议（user-questions/request）：
//   请求：{ questions: [{ id, question, detail?, header?, options?, multiSelect?, intent? }] }
//   回答：{ answers: [{ id, selected: string[], custom?: string }] }
//
// 计划评审走的是同一个协议（题目带 intent.kind === 'plan-review'），
// 所以这里完全不区分 —— 呈现差异交给渲染层。
//
// 做成纯 reducer 是为了能单测：答案编码错一个字，模型就理解错了。

import { approveLabelOf, type QuestionAnswerItem, type QuestionItem } from '../interactions.ts'

export interface QuestionFlowState {
  /** 第几题（0 起） */
  index: number
  /** 光标在第几项（选项 + 末尾的「自己输入」） */
  cursor: number
  /** 多选已选中的标签 */
  selected: string[]
  /** 自定义输入的内容 */
  custom: string
  /** 是否正在编辑自定义输入 */
  editing: boolean
  /** 已答完的题 */
  answers: QuestionAnswerItem[]
}

export type QuestionAction =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'toggle' }
  | { type: 'confirm' }
  | { type: 'insert'; text: string }
  /**
   * 直接打字。
   * 不在编辑态时 = 进入编辑态并写入这段字（省掉「先按 Enter 选中自己输入」那一步）；
   * 已在编辑态时 = 追加。
   */
  | { type: 'type'; text: string }
  | { type: 'backspace' }
  | { type: 'cancelEdit' }

/** 一道题的选项数量（含「自己输入」那一项）。 */
export function choiceCount(question: QuestionItem): number {
  return (question.options?.length ?? 0) + 1
}

/** 第几个选项是「自己输入」。 */
export function customIndex(question: QuestionItem): number {
  return question.options?.length ?? 0
}

export function initialFlow(questions: readonly QuestionItem[]): QuestionFlowState {
  const first = questions[0]
  return {
    index: 0,
    // 默认把光标停在「批准」那个选项上（计划评审时最有用的默认值）
    cursor: defaultCursor(first),
    selected: [],
    custom: '',
    editing: false,
    answers: [],
  }
}

/**
 * 默认光标停在哪一项。
 *
 * 计划评审 → 停在「批准」那一项（最常用的选择，省一次移动）。
 * 其余 → 停在第一项。
 *
 * 注意：这里**不需要**知道选项数量。早期版本写的是
 * `Math.min(0, Math.max(0, count - 1))` —— 外层上限就是 0，所以恒等于 0，
 * 看起来像「夹在 [0, 选项数-1]」其实什么都没做，还白传一个参数。
 */
function defaultCursor(question: QuestionItem | undefined): number {
  const approve = approveLabelOf(question)
  if (approve !== undefined) {
    const at = question?.options?.findIndex(o => o.label === approve) ?? -1
    if (at >= 0) return at
  }
  return 0
}

export interface ReduceResult {
  state: QuestionFlowState
  /** 全部答完时给出最终答案 */
  done?: QuestionAnswerItem[]
}

export function reduceFlow(
  state: QuestionFlowState,
  action: QuestionAction,
  questions: readonly QuestionItem[],
): ReduceResult {
  const question = questions[state.index]
  if (question === undefined) return { state }
  const count = choiceCount(question)
  const at = Math.max(0, Math.min(state.cursor, count - 1))

  switch (action.type) {
    case 'up':
      return { state: { ...state, cursor: (at - 1 + count) % count } }

    case 'down':
      return { state: { ...state, cursor: (at + 1) % count } }

    case 'toggle': {
      if (question.multiSelect !== true) return { state }
      const label = question.options?.[at]?.label
      if (label === undefined) return { state }
      const selected = state.selected.includes(label)
        ? state.selected.filter(l => l !== label)
        : [...state.selected, label]
      return { state: { ...state, selected } }
    }

    case 'cancelEdit':
      return { state: { ...state, editing: false } }

    case 'insert':
      if (!state.editing) return { state }
      return { state: { ...state, custom: state.custom + action.text } }

    case 'type':
      // 不在编辑态也照收：直接打字就等于开始自己输入
      return {
        state: {
          ...state,
          editing: true,
          custom: (state.editing ? state.custom : '') + action.text,
        },
      }

    case 'backspace':
      if (!state.editing) return { state }
      return { state: { ...state, custom: state.custom.slice(0, -1) } }

    case 'confirm': {
      const isCustom = at === customIndex(question)

      // 选中「自己输入」→ 进入编辑模式（先不提交）
      if (isCustom && !state.editing) {
        return { state: { ...state, editing: true, custom: '' } }
      }

      let answer: QuestionAnswerItem
      if (state.editing) {
        // 自定义输入模式：多选时带上已勾选的，单选时 selected 为空
        answer = {
          id: question.id,
          selected: question.multiSelect === true ? state.selected : [],
          ...(state.custom === '' ? {} : { custom: state.custom }),
        }
      } else if (question.multiSelect === true) {
        // 多选：提交的是「已勾选的集合」，不是光标所在那一项
        answer = { id: question.id, selected: state.selected }
      } else {
        const label = question.options?.[at]?.label
        if (label === undefined) return { state }
        answer = { id: question.id, selected: [label] }
      }

      const answers = [...state.answers, answer]
      const next = state.index + 1
      if (next >= questions.length) return { state: { ...state, answers }, done: answers }

      const nextQuestion = questions[next]!
      return {
        state: {
          index: next,
          cursor: defaultCursor(nextQuestion),
          selected: [],
          custom: '',
          editing: false,
          answers,
        },
      }
    }
  }
}
