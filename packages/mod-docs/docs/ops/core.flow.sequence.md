Pulse control-outs `0..count-1` IN ORDER, each waiting for the previous
branch's subgraph to quiesce. The orchestration node for "do A, then B,
then C" when the steps are side-effect regions rather than data flows.
