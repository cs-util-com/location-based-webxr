# `error-report-environment.ts` - the error reports' environment label

## Purpose

Says which environment an error report comes from, by the page's host
name, for the `environment` option of the Recorder's error reporting
(`sentry.ts`). Branch previews deploy the same production build as the
live site and send reports too; the label keeps their reports, and those
of a production build run on this machine, apart from the live site's.

## Public API

- `errorReportEnvironment(hostname)` (a `string | null | undefined`) returns
  `production`, `preview` or `development`:
  - `production`: exactly one of `PRODUCTION_HOSTS`;
  - `development`: this machine - `localhost`, `127.0.0.1`, `[::1]`,
    `::1`;
  - `preview`: a branch or commit preview
    (`<label>-gps-plus-slam.csutil.workers.dev`) and every other host,
    including an empty or missing one.
  - Never throws: a value that is not a string is `preview`.
- `PRODUCTION_HOSTS`: `gps.csutil.com` and `gps-plus-slam.csutil.workers.dev`
  (the worker's own address, which serves the same live deployment; the
  site's `wrangler.toml` leaves that address on by default, having no
  `workers_dev` key).
  - The list mirrors the custom domains set in the hosting provider's
    dashboard (`wrangler.toml` carries none) and must change with them: a
    live address missing here would file real visitors' reports as
    `preview`.

## Invariants & assumptions

- **Unknown hosts are previews, not production.** The production stream is
  the one that says real visitors hit a fault, so only the listed live
  addresses may ever land there; a fork's own deployment, a look-alike
  domain, a sub-domain or another worker on the same account is never
  counted as the live site. Calling them previews also means a new preview
  address scheme needs no change here.
- **A LAN address or a tunnel is a preview, not development.** Only
  loopback is "this machine". A production build reached over the LAN or
  a tunnel (a phone test) is rare, and either label keeps it out of
  production, which is what matters; the dev-host list of the Drive proxy
  (`GpsPlusSlamJs_TourViewer/src/drive-proxy-url.ts`) mirrors the site
  worker's CORS rule and is not reused for that reason.
- Letter case and one trailing dot are ignored, as for any host name.
- Pure; reads nothing but its argument.

## Example

```ts
errorReportEnvironment(location.hostname);
// 'gps.csutil.com'                         -> 'production'
// 'r943-gps-plus-slam.csutil.workers.dev'  -> 'preview'
// 'localhost'                              -> 'development'
```

## Tests

- `error-report-environment.test.ts` - the live addresses, previews,
  loopback hosts, case and trailing dot, look-alikes and other hosts, and
  values that are not strings.
- `error-report-environment.property.test.ts` - total over any input;
  `production` exactly for the listed hosts; every branch label in front
  of the worker's address is a preview; letter case never changes the
  answer.
- `sentry.test.ts` - the options carry the label for each kind of host.
