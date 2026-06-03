import re

with open("client/src/pages/AnalyticsPage.tsx", "r") as f:
    content = f.read()

# Fix table block to wrap in fragment
content = content.replace(
    '<div className="hidden md:block max-h-[360px] overflow-y-auto overflow-x-auto -mx-4">',
    '<>\n                <div className="hidden md:block max-h-[360px] overflow-y-auto overflow-x-auto -mx-4">'
)
content = content.replace(
    '''                      </div>
                    </div>
                  ))}
                </div>''',
    '''                      </div>
                    </div>
                  ))}
                </div>\n                </>''',
    1 # Replace only the first occurrence which corresponds to the first table replacement
)

content = content.replace(
    '<div className="hidden md:block max-h-[300px] overflow-y-auto overflow-x-auto -mx-5 px-5">',
    '<>\n              <div className="hidden md:block max-h-[300px] overflow-y-auto overflow-x-auto -mx-5 px-5">'
)

content = content.replace(
    '''                  </div>
                ))}
              </div>''',
    '''                  </div>
                ))}
              </div>\n              </>'''
)

with open("client/src/pages/AnalyticsPage.tsx", "w") as f:
    f.write(content)
