import type { CSSProperties } from 'react';
import { STATUS_COLUMNS } from '../lib/statusClassification';
import type { UnitStatusMatrix } from '../lib/segregateByUnit';

interface UnitTrapStatusMatrixProps {
  matrix: UnitStatusMatrix;
}

const cellStyle: CSSProperties = {
  border: 'var(--fds-border-default)',
  padding: 'var(--spacing-03) var(--spacing-04)',
  textAlign: 'center',
};

const headerCellStyle: CSSProperties = {
  ...cellStyle,
  background: 'var(--background-warning-default)',
  color: 'var(--text-default-primary)',
};

export function UnitTrapStatusMatrix({ matrix }: UnitTrapStatusMatrixProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '900px' }}>
        <thead>
          <tr>
            <th colSpan={2} className="BodySmallSemibold" style={headerCellStyle}>
              Unit vs Trap Status
            </th>
            {STATUS_COLUMNS.map((col) => (
              <th key={col} rowSpan={2} className="BodySmallSemibold" style={headerCellStyle}>
                {col}
              </th>
            ))}
            <th rowSpan={2} className="BodySmallSemibold" style={headerCellStyle}>
              Total
            </th>
          </tr>
          <tr>
            <th className="BodySmallSemibold" style={headerCellStyle}>
              Plant Category
            </th>
            <th className="BodySmallSemibold" style={headerCellStyle}>
              Unit Name
            </th>
          </tr>
        </thead>
        <tbody>
          {matrix.groups.map((group) => (
            group.units.map((unit, unitIndex) => (
              <tr key={`${group.plantCategory}-${unit.unitName}`}>
                {unitIndex === 0 && (
                  <td
                    rowSpan={group.units.length}
                    className="BodyMediumRegular"
                    style={{ ...cellStyle, textAlign: 'left', verticalAlign: 'top' }}
                  >
                    {group.plantCategory}
                  </td>
                )}
                <td className="BodyMediumRegular" style={{ ...cellStyle, textAlign: 'left' }}>
                  {unit.unitName}
                </td>
                {STATUS_COLUMNS.map((col) => (
                  <td key={col} className="BodyMediumRegular" style={cellStyle}>
                    {unit.counts[col]}
                  </td>
                ))}
                <td className="BodyMediumSemibold" style={cellStyle}>
                  {unit.total}
                </td>
              </tr>
            ))
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="BodyMediumSemibold" style={{ ...cellStyle, textAlign: 'left' }}>
              Total
            </td>
            {STATUS_COLUMNS.map((col) => (
              <td key={col} className="BodyMediumSemibold" style={cellStyle}>
                {matrix.grandTotal[col]}
              </td>
            ))}
            <td className="BodyMediumSemibold" style={cellStyle}>
              {matrix.grandTotalCount}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
