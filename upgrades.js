var H5PUpgrades = H5PUpgrades || {};

/**
 * Content upgrade for H5P.ColumnConnector.
 *
 * 1.x stored columns as four fixed groups (columnOne..columnFour), the column
 * count in behaviour.columns, image settings as flat cell fields, and the
 * answer key as per-cell correctToColumnOne/Two/Three fields.
 *
 * 2.0 stores columns as a single "columns" list, image settings in a nested
 * "image" group, and the answer key as a per-cell "correctToPrevious" field.
 */
H5PUpgrades['H5P.ColumnConnector'] = (function () {
  return {
    2: {
      /**
       * Upgrade to 2.0.
       */
      0: function (parameters, finished, extras) {
        parameters = parameters || {};

        var LEGACY_COLUMN_KEYS = ['columnOne', 'columnTwo', 'columnThree', 'columnFour'];
        var LEGACY_TITLE_KEYS = ['columnOneTitle', 'columnTwoTitle', 'columnThreeTitle', 'columnFourTitle'];
        var LEGACY_CORRECT_KEYS = ['correctToColumnOne', 'correctToColumnTwo', 'correctToColumnThree'];

        // 1.3 rendered exactly behaviour.columns columns (sliced), so reproduce
        // that count. Fall back to the highest populated column only when the
        // count is missing/invalid — never add a column 1.3 did not show.
        var declared = parseInt(parameters.behaviour && parameters.behaviour.columns, 10);
        if (isNaN(declared) || declared < 2) {
          var highestPopulated = 0;
          for (var p = 0; p < LEGACY_COLUMN_KEYS.length; p++) {
            var legacy = parameters[LEGACY_COLUMN_KEYS[p]];
            if (legacy && ((legacy.cells && legacy.cells.length) || legacy.title)) {
              highestPopulated = p + 1;
            }
          }
          declared = highestPopulated || 2;
        }
        var count = Math.max(2, Math.min(4, declared));

        function migrateCell(oldCell, columnIndex) {
          oldCell = oldCell || {};

          var position = oldCell.imagePosition === 'left' ? 'left' : 'above';
          var size;
          if (position === 'left') {
            size = oldCell.imageLeftSize === 'medium' ? 'medium' : 'small';
          }
          else {
            // Above images rendered at full width in 1.x.
            size = 'large';
          }

          var image = {
            position: position,
            size: size,
            // Preserve the 1.x appearance (above images were left-aligned).
            align: 'left'
          };
          if (oldCell.image) {
            image.file = oldCell.image;
          }
          // url and alt live in a nested imageExtra group so they stay under the
          // "Add image" group without becoming its collapsed title.
          var extra = {};
          if (oldCell.imageUrl) {
            extra.url = oldCell.imageUrl;
          }
          if (oldCell.alt) {
            extra.alt = oldCell.alt;
          }
          if (extra.url !== undefined || extra.alt !== undefined) {
            image.imageExtra = extra;
          }

          var newCell = {
            text: oldCell.text || '',
            image: image
          };

          // Answer key: each column after the first connects to the previous one.
          if (columnIndex >= 1) {
            var legacyValue = oldCell[LEGACY_CORRECT_KEYS[columnIndex - 1]];
            if (legacyValue !== undefined && legacyValue !== null && legacyValue !== '') {
              newCell.correctToPrevious = legacyValue;
            }
          }

          return newCell;
        }

        var columns = [];
        for (var i = 0; i < count; i++) {
          var legacyColumn = parameters[LEGACY_COLUMN_KEYS[i]] || {};
          var legacyCells = (legacyColumn && legacyColumn.cells) || [];
          var newColumn = {
            title: (legacyColumn && legacyColumn.title) || parameters[LEGACY_TITLE_KEYS[i]] || '',
            cells: []
          };

          for (var c = 0; c < legacyCells.length; c++) {
            newColumn.cells.push(migrateCell(legacyCells[c], i));
          }

          columns.push(newColumn);
        }

        parameters.columns = columns;

        // Remove obsolete 1.x fields.
        for (var k = 0; k < LEGACY_COLUMN_KEYS.length; k++) {
          delete parameters[LEGACY_COLUMN_KEYS[k]];
          delete parameters[LEGACY_TITLE_KEYS[k]];
        }
        if (parameters.behaviour) {
          delete parameters.behaviour.columns;

          // 2.0 moves the learner instructions from behaviour to the top level.
          if (parameters.behaviour.instructions !== undefined) {
            parameters.instructions = parameters.behaviour.instructions;
            delete parameters.behaviour.instructions;
          }
        }
        delete parameters.answerKeyByCells;

        finished(null, parameters, extras);
      }
    }
  };
})();
