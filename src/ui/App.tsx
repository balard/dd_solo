/**
 * Phase 0 exit criterion: every die in the starter set, read from the real data
 * files through the real loader.
 *
 * This is a data-pipeline smoke test wearing a UI costume. It is deliberately not
 * the game, and it gets replaced wholesale in Phase 7.
 */
import { SPECIES, TERRAIN_DICE, TERRAIN_TYPES, unitsOfSpecies } from '../data/load'
import type { Face, TerrainFaceNumber, UnitType } from '../data/types'

const FACE_NUMBERS: readonly TerrainFaceNumber[] = [1, 2, 3, 4, 5, 6, 7]

function faceLabel(face: Face): string {
  return face.icon === 'SAI' ? face.sai : face.icon.toLowerCase()
}

function FaceChip({ face }: { face: Face }) {
  return (
    <span className={`face i-${face.icon}`}>
      <b>{face.count}</b>
      <span>{faceLabel(face)}</span>
    </span>
  )
}

function UnitRow({ unit }: { unit: UnitType }) {
  return (
    <tr>
      <td className="name">{unit.name}</td>
      <td className="meta">
        {unit.health}h · {unit.dieType}
      </td>
      <td className="meta">{unit.unitClass.replace('_', ' ')}</td>
      <td>
        <div className="faces">
          {unit.faces.map((face, i) => (
            <FaceChip key={i} face={face} />
          ))}
        </div>
      </td>
    </tr>
  )
}

export function App() {
  const unitCount = SPECIES.reduce((n, s) => n + unitsOfSpecies(s.id).length, 0)
  const faceCount = SPECIES.reduce(
    (n, s) => n + unitsOfSpecies(s.id).reduce((m, u) => m + u.faces.length, 0),
    0,
  )

  return (
    <div className="wrap">
      <h1>dd_solo — die data</h1>
      <p className="sub">
        {unitCount} unit dice ({faceCount} faces) and {TERRAIN_DICE.length} terrain dice, loaded and
        validated from <code>data/starter/</code>.
      </p>

      {SPECIES.map((species) => (
        <section key={species.id}>
          <h2>
            {species.name} <span className="sub">— {species.elements.join(' + ')}</span>
          </h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Size</th>
                  <th>Class</th>
                  <th>Faces</th>
                </tr>
              </thead>
              <tbody>
                {unitsOfSpecies(species.id).map((unit) => (
                  <UnitRow key={unit.id} unit={unit} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section>
        <h2>Terrains</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Elements</th>
                {FACE_NUMBERS.map((n) => (
                  <th key={n}>{n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TERRAIN_TYPES.map((type) => (
                <tr key={type.id}>
                  <td className="name">{type.name}</td>
                  <td className="meta">{type.elements.join(' + ')}</td>
                  {FACE_NUMBERS.map((n) => (
                    <td key={n} className={`meta i-${type.faces[n]}`}>
                      {type.faces[n].toLowerCase()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Face 8 is the eighth face. Each type exists in four variants —{' '}
          {TERRAIN_DICE.filter((d) => d.type === TERRAIN_TYPES[0]?.id)
            .map((d) => d.eighthFace.replace('_', ' '))
            .join(', ')}{' '}
          — identical on faces 1–7. The split points differ per type, and that difference is most of
          what distinguishes these dice.
        </p>
      </section>
    </div>
  )
}
