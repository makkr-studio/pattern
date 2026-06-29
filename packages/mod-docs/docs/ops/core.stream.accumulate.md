The stream→value adapter (a barrier): drains the input stream and resolves
one accumulated value (string concat / array of chunks). Use it when a
downstream op needs the WHOLE result. It waits for the stream to end before
resolving.
