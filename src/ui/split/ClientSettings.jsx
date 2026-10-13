import { useState } from 'react';
import { valueShape } from '../../core/detect.js';
import { describeShape } from '../../core/verify.js';

/**
 * Each client with a saved box, what their invoice numbers look like, and a way
 * to change that or forget the client.
 *
 * Only the shape of a number is kept - "2 letters, a hyphen, then 5 digits" -
 * never a number. To change it, type an example number: its shape is taken and
 * the example itself is not kept.
 */
export default function ClientSettings({ boxes, learned, onSetShape, onForget, onForgetAll }) {
  return (
    <section
      className="settings-card"
      aria-labelledby="clients-heading"
      data-testid="remembered-boxes"
    >
      <h3 id="clients-heading">Clients</h3>
      {boxes.length === 0 ? (
        <p className="muted" data-testid="no-clients">
          None yet. Draw a box around the invoice number on a page in the Split tab, and that client
          is remembered here.
        </p>
      ) : (
        <>
          <p>
            {boxes.length === 1
              ? 'One client is remembered in this browser.'
              : `${boxes.length} clients are remembered in this browser.`}{' '}
            Their numbers are checked against the shape shown.
          </p>
          <ul className="client-list">
            {boxes.map((box) => (
              <Client
                key={box.id}
                box={box}
                learned={learned?.[box.id]}
                onSetShape={onSetShape}
                onForget={onForget}
              />
            ))}
          </ul>
          <button
            type="button"
            className="button quiet danger-button"
            data-testid="forget-boxes"
            onClick={onForgetAll}
          >
            Forget all clients
          </button>
        </>
      )}
    </section>
  );
}

function Client({ box, learned, onSetShape, onForget }) {
  const [example, setExample] = useState('');
  const shape = example.trim() ? valueShape(example.trim()) : '';
  const others = (learned?.shapes ?? []).filter((entry) => entry !== box.zoneShape);

  const apply = () => {
    if (!shape) return;
    onSetShape(box.id, shape);
    setExample('');
  };

  return (
    <li data-testid={`client-${box.id}`}>
      <span className="client-name">{box.name}</span>
      <button
        type="button"
        className="link-button"
        onClick={() => onForget(box.id)}
        data-testid={`forget-client-${box.id}`}
      >
        Forget
      </button>
      <span className="client-shape">
        <span>
          {box.zoneShape
            ? `Numbers look like: ${describeShape(box.zoneShape)}.`
            : 'No number shape kept yet.'}
          {others.length > 0 &&
            ` Also seen: ${others.map((entry) => describeShape(entry)).join('; ')}.`}
        </span>
      </span>
      <span className="client-shape">
        <label>
          <span className="visually-hidden">An example of {box.name}&rsquo;s invoice numbers</span>
          <input
            type="text"
            placeholder="Example number, e.g. AB-12345"
            value={example}
            onChange={(event) => setExample(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply();
            }}
            data-testid={`client-example-${box.id}`}
          />
        </label>
        <button
          type="button"
          className="button quiet"
          disabled={!shape}
          onClick={apply}
          data-testid={`client-apply-${box.id}`}
        >
          Use this shape
        </button>
        {shape && <span>{describeShape(shape)}</span>}
      </span>
    </li>
  );
}
