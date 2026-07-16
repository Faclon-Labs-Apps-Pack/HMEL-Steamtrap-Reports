import type { CSSProperties } from 'react';
import type { CorrectiveActionMatrixData } from '../lib/segregateCorrectiveActions';

interface CorrectiveActionMatrixProps {
  matrix: CorrectiveActionMatrixData;
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

export function CorrectiveActionMatrix({ matrix }: CorrectiveActionMatrixProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '700px' }}>
        <thead>
          <tr>
            <th className="BodySmallSemibold" style={headerCellStyle}>
              Plant Category
            </th>
            <th className="BodySmallSemibold" style={headerCellStyle}>
              Unit Name
            </th>
            <th className="BodySmallSemibold" style={headerCellStyle}>
              Corrective Action
            </th>
            <th className="BodySmallSemibold" style={headerCellStyle}>
              No. of Status changes
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
                <td className="BodyMediumRegular" style={cellStyle}>
                  {unit.correctiveActionCount}
                </td>
                <td className="BodyMediumRegular" style={cellStyle}>
                  {unit.statusChangeCount}
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
            <td className="BodyMediumSemibold" style={cellStyle}>
              {matrix.grandTotalCorrectiveActions}
            </td>
            <td className="BodyMediumSemibold" style={cellStyle}>
              {matrix.grandTotalStatusChanges}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
