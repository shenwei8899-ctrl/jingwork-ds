// @vitest-environment jsdom
/** Task controls render persistent state without optimistic lifecycle changes. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SuperAgentTask } from '@deepseek-ai/dsh-super-agent/types'
import type { GoalId } from '@deepseek-ai/dsh-goal/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { SuperAgentCard } from '../src/client/SuperAgent.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)
afterEach(cleanup)
const task: SuperAgentTask = {
  goalId: 'task-one' as GoalId, objective: '完成登录功能', phase: 'active', blocker: null, workerIds: [],
  todos: [{ content: '检查现有实现', status: 'completed' }, { content: '实现登录', status: 'in_progress' }],
}

describe('Super Agent task card', () => {
  it('shows progress, expands steps, and single-flights pause requests', async () => {
    const pause = Promise.withResolvers<{ ok: true; value: undefined }>()
    const control = vi.fn(() => pause.promise)
    render(<SuperAgentCard task={task} activation="armed" control={control} t={t} />)
    expect(screen.getByRole('status').textContent).toBe('执行中')
    expect(screen.getByText('已完成 1 / 2 项')).toBeTruthy()
    fireEvent.click(screen.getByText('已完成 1 / 2 项'))
    expect(screen.getByText('实现登录')).toBeTruthy()
    const button = screen.getByRole('button', { name: '暂停' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(control).toHaveBeenCalledExactlyOnceWith('pause')
    expect(button.hasAttribute('disabled')).toBe(true)
    pause.resolve({ ok: true, value: undefined })
    await waitFor(() =>{  expect(button.hasAttribute('disabled')).toBe(false) })
    expect(screen.getByRole('status').textContent).toBe('执行中')
  })

  it('offers explicit resume after restart and retains progress after a control failure', async () => {
    const control = vi.fn().mockRejectedValue(new Error('Worker unavailable'))
    render(<SuperAgentCard task={task} activation="disarmed" control={control} t={t} />)
    expect(screen.getByRole('status').textContent).toBe('已暂停')
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await screen.findByRole('alert')
    expect(screen.getByText('Worker unavailable')).toBeTruthy()
    expect(screen.getByText(task.objective)).toBeTruthy()
    expect(screen.getByText('已完成 1 / 2 项')).toBeTruthy()
  })

  it('keeps completed and stopped tasks visible with their retained steps', () => {
    const view = render(<SuperAgentCard task={{ ...task, phase: 'complete' }} activation={undefined} control={undefined} t={t} />)
    expect(screen.getByRole('status').textContent).toBe('已完成')
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<SuperAgentCard task={{ ...task, phase: 'stopped' }} activation={undefined} control={undefined} t={t} />)
    expect(screen.getByRole('status').textContent).toBe('已停止')
    expect(screen.getByText(task.objective)).toBeTruthy()
  })
})
