import json,sys
from pathlib import Path
# Requires Shapely. Pass the downloaded Queensland locality GeoJSON as the argument.
root=Path(__file__).resolve().parent.parent
from shapely.geometry import shape,Point
from shapely.strtree import STRtree
from shapely import make_valid
from collections import defaultdict
d=json.load(open(sys.argv[1],encoding='utf-8'))
features=d['features']
geoms=[make_valid(shape(f['geometry'])) for f in features]
tree=STRtree(geoms)
neighbors=[set() for f in features]
for i,g in enumerate(geoms):
 for j in tree.query(g,predicate='dwithin',distance=0.00002):
  j=int(j)
  if j<=i: continue
  # Shared borders longer than a corner, allowing for coordinate rounding.
  if g.boundary.intersection(geoms[j].boundary.buffer(0.00001)).length>0.0001:
   neighbors[i].add(j);neighbors[j].add(i)
source=open(root/'lib/queensland-locality-centroids.js',encoding='utf-8-sig').read()
centroids=json.loads(source[source.index('export default ')+15:].strip().rstrip(';'))
norm=lambda s:s.lower().strip().replace(''',"'")
byname=defaultdict(list)
for i,f in enumerate(features):byname[norm(f['properties']['locality'])].append(i)
keys=defaultdict(list)
for name,postcode,weight,lat,lon in centroids:
 ids=byname[norm(name)]
 if not ids:continue
 point=Point(lon,lat)
 idx=min(ids,key=lambda i:geoms[i].distance(point))
 if geoms[idx].distance(point)>0.05:continue
 keys[idx].append(norm(name)+'/'+postcode)
graph={}
for i,ids in keys.items():
 adjacent=sorted({key for j in neighbors[i] for key in keys.get(j,[])})
 for key in ids:graph[key]=adjacent
header='// Adjoining localities derived from Queensland Government Locality boundaries.\n// Source: https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Boundaries/AdministrativeBoundaries/MapServer/2\n// Copyright State of Queensland 2026. Generated from shared polygon borders, 27 November 2026.\n'
open(root/'lib/queensland-locality-neighbors.js','w',encoding='utf-8').write(header+'export default '+json.dumps(graph,separators=(',',':'))+';\n')
print(json.dumps({'polygons':len(features),'localities':len(graph),'neighbors':sum(map(len,graph.values())),'greenbank':graph.get('greenbank/4124'),'ipswich':graph.get('ipswich/4305')}))

