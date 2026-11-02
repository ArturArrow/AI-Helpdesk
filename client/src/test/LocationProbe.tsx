import { useLocation, useNavigationType } from 'react-router'

// Shows the router's current query string and how it got there (PUSH or REPLACE), so a test
// can check what the page wrote to the URL. Render it next to the page inside the router and
// read it with urlSearch() / navigationType() from ./location.ts.
export function LocationProbe() {
  return (
    <>
      <output aria-label="URL search">{useLocation().search}</output>
      <output aria-label="Navigation type">{useNavigationType()}</output>
    </>
  )
}
