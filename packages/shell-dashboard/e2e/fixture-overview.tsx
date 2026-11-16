import { Ellipsis, ExternalLink, Filter, RefreshCw, Rocket } from 'lucide-react';

const SERVICES = [
  ['memory', '13.0.2', 1, '48 ms', '12m ago'],
  ['auth', '4.3.1', 1, '31 ms', '2h ago'],
  ['fixture', '0.2.14', 1, '22 ms', '5m ago'],
  ['probe', '0.4.0', 1, '17 ms', '1d ago'],
  ['logs', '0.3.7', 0, '212 ms', '3h ago'],
  ['market', '0.1.9', 1, '64 ms', '2d ago'],
] as const;

const I = { className: 'i', 'aria-hidden': true } as const;

export const Actions = () => (
  <>
    <button className="ib" aria-label="Refresh">
      <RefreshCw {...I} />
    </button>
    <button className="ib hm" aria-label="Filter">
      <Filter {...I} />
    </button>
    <button className="ib hm" aria-label="Open in new window">
      <ExternalLink {...I} />
    </button>
    <button className="ib" aria-label="More actions">
      <Ellipsis {...I} />
    </button>
    <span className="vr" />
    <button className="deploy">
      <Rocket {...I} />
      Deploy
    </button>
  </>
);

export const Overview = () => (
  <div className="scroll">
    <p className="sub">State of the platform across all hosts.</p>
    <div className="stats">
      {[
        ['Extensions', '7', ''],
        ['Hosts', '5', ''],
        ['Errors 24h', '3', 'bad'],
        ['Last deploy', '5m13s', 'mono'],
      ].map(([k, v, c]) => (
        <div className="card" key={k}>
          <small>{k}</small>
          <strong className={c}>{v}</strong>
        </div>
      ))}
    </div>
    <h2>Services</h2>
    {/* A scrolling table must take focus (axe scrollable-region-focusable at 400 px). */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
    <div className="tw" role="region" aria-label="Services" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {['Name', 'Version', 'Status', 'p95', 'Last deploy'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SERVICES.map(([n, v, ok, p, d]) => (
            <tr key={n}>
              <td>{n}</td>
              <td className="mono">{v}</td>
              <td>
                <span className={ok ? 'sd' : 'sd bad'} />
                {ok ? 'healthy' : 'degraded'}
              </td>
              <td className="mono">{p}</td>
              <td className="muted">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
