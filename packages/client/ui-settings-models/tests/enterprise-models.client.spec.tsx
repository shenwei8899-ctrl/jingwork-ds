// @vitest-environment jsdom
/** Enterprise model selection, refresh and failure feedback. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EnterpriseModels } from '../src/client/EnterpriseModels.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('loads authorized models and saves the selected new-conversation default', async () => {
  const load = vi.fn().mockResolvedValue({ models: [{ id: 'company:chat', name: 'Company chat', provider: 'company' }], defaultModel: 'company:chat', selectedModel: null })
  const select = vi.fn().mockResolvedValue(undefined)
  const { container } = render(<EnterpriseModels load={load} select={select} t={key => en[key]} />)
  await screen.findByRole('option', { name: 'Company chat · company' })
  fireEvent.click(screen.getByRole('button', { name: en.enterpriseUse }))
  await screen.findByRole('button', { name: en.enterpriseSelected })
  expect(select).toHaveBeenCalledWith('company:chat')
  expect(container.textContent).toMatchInlineSnapshot(
    '"Enterprise modelsRefreshCompany chat · companySwitch the current conversation in its model selector.Current default"',
  )
  fireEvent.click(screen.getByRole('button', { name: en.enterpriseRefresh }))
  await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
})

it('shows an actionable error and supports retrying an empty directory', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('private details')).mockResolvedValue({ models: [], defaultModel: null, selectedModel: null })
  render(<EnterpriseModels load={load} select={vi.fn()} t={key => en[key]} />)
  expect((await screen.findByRole('alert')).textContent).toBe(en.enterpriseFailed)
  expect(screen.queryByText('private details')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.enterpriseRefresh }))
  await screen.findByText(en.enterpriseEmpty)
  expect(screen.queryByRole('combobox')).toBeNull()
})
