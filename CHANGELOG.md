# Changelog

## Unreleased

- The one-second clock tick restarts when it stops. A refused period or a
  hot reload can stop the tick. Status and turn events now start it again
  when it has not run for 5 seconds.
- A resumed session keeps the clock tick and re-measures the context, as a
  `/clear` does. Only a session that ends for good stops the tick.
- Hovering the cache segment shows the local time of the last response:
  `cached at 14:32`, `cached 14:32` or `since 14:32`, in the first form
  that fits the segment's width.
