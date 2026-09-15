/**
 * Elements, shown at last.
 *
 * Every species and terrain has carried its elements since the data was
 * transcribed, and nothing on screen used them. They do not affect play in v0 --
 * there are no spells -- but they are what tells you at a glance that Treefolk
 * belong on Swampland and Firewalkers on Wasteland, and why Highland is the
 * terrain both sides can half-claim.
 */
import { SPECIES } from '../../data/load'
import type { Element } from '../../data/types'

export const ELEMENT_NAME: Record<Element, string> = {
  air: 'air',
  water: 'water',
  earth: 'earth',
  fire: 'fire',
  death: 'death',
  ivory: 'ivory',
}

export function ElementDots({ elements, title }: { elements: readonly Element[]; title?: string }) {
  return (
    <span
      className="elements"
      title={title ?? elements.map((e) => ELEMENT_NAME[e]).join(' + ')}
      aria-label={elements.map((e) => ELEMENT_NAME[e]).join(' and ')}
    >
      {elements.map((element) => (
        <i key={element} className={`el el-${element}`} />
      ))}
    </span>
  )
}

export function speciesInfo(speciesId: string) {
  return SPECIES.find((s) => s.id === speciesId) ?? null
}
