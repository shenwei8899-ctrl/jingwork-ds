// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { JingworkBrandMark, JingworkBrandName } from '../src/client/Brand.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('shows the JingWork image and the two-line product name', () => {
  const mark = render(<JingworkBrandMark size={24} />)
  expect(mark.container.querySelector('img')?.getAttribute('src')).toContain('jingwork-agent.png')
  expect(mark.container.querySelector('img')?.getAttribute('width')).toBe('24')
  const dictionary: Record<string, string> = zh
  const name = render(<JingworkBrandName t={key => dictionary[key] ?? key} />)
  expect(Array.from(name.container.querySelectorAll('span > span')).map(node => node.textContent))
    .toEqual(['竞网蓝鲸', 'JingWork'])
})
