/**
 * The interface is built in the next phase. Until then this page says what the
 * project is and what it will never do with your files, so that a visit to the
 * live demo is not a blank screen.
 */
export default function App() {
  return (
    <main className="shell">
      <h1>Invoice Splitter</h1>
      <p className="lead">
        Takes a bulk PDF full of invoices, works out which pages belong to which invoice, and saves
        each one as its own correctly named PDF.
      </p>
      <p className="privacy">
        Your files never leave this browser. There is no server, no upload, and no analytics. You
        can check that yourself: open your browser&rsquo;s network tab and watch it stay empty while
        you work.
      </p>
      <p className="status">
        The splitting engine is finished and tested. The interface arrives in the next phase.
      </p>
    </main>
  );
}
