/**
 * Asking to be shown where the invoice number is.
 *
 * Every client prints invoices differently, and the quickest way to teach the
 * app one of them is to draw a box around the number once, on the first page of
 * theirs in the batch. This card asks for exactly that, and names the page.
 *
 * It asks about whichever page comes first that no saved spot covers. On a batch
 * from one client that is page 1, and once it has been pointed at the card goes
 * away. On a batch from several clients it moves on to the first page of the
 * next client nobody has pointed at yet, so they can be taught one by one. A
 * client taught in an earlier batch is covered already, and never asked about
 * again.
 */
export default function PointPrompt({ page, anyPointed, onPoint, onDismiss }) {
  return (
    <div className="point-prompt" data-testid="point-prompt">
      <p>
        {anyPointed ? (
          <>
            <strong>Some pages are not read from a saved spot yet.</strong> They may be from another
            client. Show the app where the invoice number is on page {page}, and every page like it
            is read the same way.
          </>
        ) : (
          <>
            <strong>Show the app where the invoice number is.</strong> Draw a box around it on the
            first invoice, and every page like it is read from that same spot &mdash; in this batch,
            and in this client&rsquo;s next one.
          </>
        )}
      </p>
      <div className="point-prompt-actions">
        <button
          type="button"
          className="button"
          data-testid="point-prompt-go"
          onClick={() => onPoint(page)}
        >
          Point to it on page {page}
        </button>
        <button
          type="button"
          className="link-button"
          data-testid="point-prompt-dismiss"
          onClick={onDismiss}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
