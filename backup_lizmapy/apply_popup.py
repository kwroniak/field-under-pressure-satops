# Uruchom w QGIS: Wtyczki -> Konsola Pythona -> "Pokaż edytor" -> otwórz ten plik -> Uruchom.
# Robi 3 rzeczy w otwartym projekcie satops_project:
#  1) dodaje tabele field_calendar i field_profile (service=hackathon) do grupy "hidden",
#  2) wstawia nowy map tip warstwy fields z maptip_fields.html,
#  3) zapisuje projekt.
# Potem: wtyczka Lizmap -> Zapisz (cfg).
from pathlib import Path
from qgis.core import QgsProject, QgsVectorLayer, QgsDataSourceUri

MAPTIP = Path(r"C:\Users\mateu\Downloads\field-under-pressure-satops-dev\lizmap_holy_crop\maptip_fields.html")

project = QgsProject.instance()
root = project.layerTreeRoot()
hidden = root.findGroup("hidden") or root.addGroup("hidden")

for table, key in (("field_calendar", "id"), ("field_profile", "field_id")):
    if project.mapLayersByName(table):
        print(f"{table}: już jest w projekcie")
        continue
    uri = QgsDataSourceUri()
    uri.setConnection("hackathon", "", "", "")  # service=hackathon, bez loginu/hasła
    uri.setDataSource("public", table, None, "", key)
    layer = QgsVectorLayer(uri.uri(False), table, "postgres")
    if not layer.isValid():
        raise RuntimeError(f"{table}: warstwa niepoprawna - sprawdź połączenie service=hackathon")
    project.addMapLayer(layer, False)
    hidden.addLayer(layer)
    print(f"{table}: dodano ({layer.featureCount()} wierszy)")

fields = project.mapLayersByName("fields")[0]
fields.setMapTipTemplate(MAPTIP.read_text(encoding="utf-8"))
print("fields: map tip podmieniony")

# Szybka weryfikacja wyrażeń na jednym polu z profilem
from qgis.core import QgsExpression, QgsExpressionContext, QgsExpressionContextUtils, QgsFeatureRequest
profile_ids = [f["field_id"] for f in project.mapLayersByName("field_profile")[0].getFeatures(QgsFeatureRequest().setLimit(1))]
if profile_ids:
    feat = next(fields.getFeatures(QgsFeatureRequest().setFilterExpression(f'"id" = {profile_ids[0]}')))
    ctx = QgsExpressionContext(QgsExpressionContextUtils.globalProjectLayerScopes(fields))
    ctx.setFeature(feat)
    exp = QgsExpression("aggregate('field_calendar','count',\"id\",filter:=\"field_id\"=attribute(@parent,'id'))")
    print(f"Test pole {profile_ids[0]}: wierszy kalendarza = {exp.evaluate(ctx)}  (oczekiwane 28)",
          exp.evalErrorString() or "")

project.write()
print("Projekt zapisany. Teraz wtyczka Lizmap -> Zapisz.")
