import re

with open("client/src/pages/AnalyticsPage.tsx", "r") as f:
    content = f.read()

# Replace Per-model breakdown table
table_match = re.search(r'(<div className="max-h-\[360px\] overflow-y-auto overflow-x-auto -mx-4">\s*<Table className="w-full min-w-\[700px\]">.*?</Table>\s*</div>)', content, re.DOTALL)

if table_match:
    table_block = table_match.group(1)
    # Wrap the table in hidden md:block, and add the mobile view
    new_block = f"""<div className="hidden md:block max-h-[360px] overflow-y-auto overflow-x-auto -mx-4">
                  <Table className="w-full min-w-[700px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Model</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Success</TableHead>
                        <TableHead className="text-right">Latency</TableHead>
                        <TableHead className="text-right">In tokens</TableHead>
                        <TableHead className="text-right pr-4">Out tokens</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {{byModel.map((m: any, i: number) => (
                        <TableRow key={{i}}>
                          <TableCell className="pl-4 text-sm font-medium">{{m.displayName}}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{{m.platform}}</TableCell>
                          <TableCell className="text-right tabular-nums">{{m.requests}}</TableCell>
                          <TableCell className="text-right tabular-nums">{{m.successRate}}%</TableCell>
                          <TableCell className="text-right tabular-nums">{{m.avgLatencyMs}} ms</TableCell>
                          <TableCell className="text-right tabular-nums">{{formatTokens(m.totalInputTokens)}}</TableCell>
                          <TableCell className="text-right tabular-nums pr-4">{{formatTokens(m.totalOutputTokens)}}</TableCell>
                        </TableRow>
                      ))}}
                    </TableBody>
                  </Table>
                </div>

                <div className="md:hidden flex flex-col gap-3">
                  {{byModel.map((m: any, i: number) => (
                    <div key={{i}} className="bg-card border rounded-lg p-4 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium text-sm">{{m.displayName}}</div>
                          <div className="text-xs text-muted-foreground">{{m.platform}}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-medium">{{m.requests}} reqs</div>
                          <div className="text-xs text-muted-foreground">{{m.successRate}}% ok</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs tabular-nums bg-muted/50 p-2 rounded-md">
                        <div>
                          <div className="text-muted-foreground mb-0.5">Latency</div>
                          <div>{{m.avgLatencyMs}}ms</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-0.5">In</div>
                          <div>{{formatTokens(m.totalInputTokens)}}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-0.5">Out</div>
                          <div>{{formatTokens(m.totalOutputTokens)}}</div>
                        </div>
                      </div>
                    </div>
                  ))}}
                </div>"""
    content = content.replace(table_block, new_block)

# Replace Recent errors table
errors_match = re.search(r'(<div className="max-h-\[300px\] overflow-y-auto overflow-x-auto -mx-5 px-5">\s*<Table className="w-full min-w-\[600px\]">.*?</Table>\s*</div>)', content, re.DOTALL)

if errors_match:
    errors_block = errors_match.group(1)
    new_errors_block = f"""<div className="hidden md:block max-h-[300px] overflow-y-auto overflow-x-auto -mx-5 px-5">
                <Table className="w-full min-w-[600px]">
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="w-[120px]">Provider</TableHead>
                      <TableHead>Message / Stack Trace</TableHead>
                      <TableHead className="text-right w-[100px]">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {{errors.slice(0, 20).map((e: any) => (
                      <TableRow key={{e.id}} className="border-border/50">
                        <TableCell className="text-xs font-medium">{{e.platform}}</TableCell>
                        <TableCell className="text-xs">
                          <div className="font-mono bg-muted/40 p-1.5 rounded-md text-muted-foreground truncate max-w-[200px] sm:max-w-[300px] md:max-w-[400px]">
                            {{e.error}}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                          {{formatSqliteUtcToLocalTime(e.createdAt, {{ hour: '2-digit', minute: '2-digit' }})}}
                        </TableCell>
                      </TableRow>
                    ))}}
                  </TableBody>
                </Table>
              </div>

              <div className="md:hidden flex flex-col gap-3 mt-2">
                {{errors.slice(0, 20).map((e: any) => (
                  <div key={{e.id}} className="bg-card border border-destructive/20 rounded-lg p-3 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium px-2 py-0.5 bg-muted rounded-md">{{e.platform}}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {{formatSqliteUtcToLocalTime(e.createdAt, {{ hour: '2-digit', minute: '2-digit' }})}}
                      </span>
                    </div>
                    <div className="font-mono bg-destructive/10 text-destructive p-2 rounded-md text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
                      {{e.error}}
                    </div>
                  </div>
                ))}}
              </div>"""
    content = content.replace(errors_block, new_errors_block)

with open("client/src/pages/AnalyticsPage.tsx", "w") as f:
    f.write(content)
