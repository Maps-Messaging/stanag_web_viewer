# STANAG task JSON notes

This document records schema details that are easy to lose when adding task support. The generated JSON uses several nested discriminated unions, because apparently XML's spirit survived the migration.

## General rule

Do not infer a JSON structure merely from the Java field name or from another task type. Check the concrete IDL or generated JSON schema for every nested union.

A task value can require more than one discriminator at different levels:

1. The task description discriminator, for example `TaskTypeEnum_LOITER`.
2. The value-union discriminator, for example `ValueTypeEnum_POSE`.
3. The concrete position discriminator, for example `PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE`.

These discriminators are not interchangeable and none of the intermediate wrappers should be omitted.

## LOITER with a point

The `loiter.pose` field is a Value union. It must select the `POSE` member before the nested Pose selects its Position union.

```json
{
  "$discriminator": "TaskTypeEnum_LOITER",
  "loiter": {
    "pose": {
      "$discriminator": "ValueTypeEnum_POSE",
      "pose": {
        "position": {
          "$discriminator": "PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE",
          "latitude_longitude_altitude": {
            "latitude": 59.48334472850266,
            "longitude": 24.819098565407046,
            "altitude": [
              {
                "type": "AltitudeTypeEnum_WGS",
                "value": 100
              }
            ]
          }
        }
      }
    }
  }
}
```

Do not emit `identifier` or `timestamp` inside this value union unless the concrete schema explicitly requires them.

## Geometry Point altitude

`GeometryTypeEnum_POINT.point` uses `base/location/Point`. Its altitude is a scalar number:

```json
{
  "$discriminator": "GeometryTypeEnum_POINT",
  "point": {
    "latitude": 59.46907728477552,
    "longitude": 24.80701260921535,
    "altitude": 100
  }
}
```

Do not use the typed altitude array for a geometry Point. The typed altitude array belongs to `LATITUDE_LONGITUDE_ALTITUDE` position values.

## PATROL geometry

Supported web-app forms currently use:

- `GeometryTypeEnum_CIRCLE`
- `GeometryTypeEnum_RECTANGLE`
- `GeometryTypeEnum_POLYGON_AREA`
- `GeometryTypeEnum_CORRIDOR_AREA`

`RECTANGLE_BY_CENTRE` is not valid for the HiBW PATROL task geometry used here.

Distance fields such as circle radius and corridor width use:

```json
{
  "value": 1000.0,
  "unit": "M"
}
```

Polygon rings should be closed when serialised. Rectangle points should remain the four explicit corners unless the schema being used says otherwise.
