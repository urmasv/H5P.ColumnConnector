var H5P = H5P || {};

H5P.ColumnConnector = (function ($, EventDispatcher) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function ColumnConnector(params, contentId, contentData) {
    EventDispatcher.call(this);

    this.params = $.extend(true, {}, ColumnConnector.defaults, params || {});
    this.params.l10n = getL10n(this.params);
    this.layoutMode = this.params.layoutMode === 'rows' ? 'rows' : 'columns';
    this.contentId = contentId;
    this.contentData = contentData || {};
    var columnList = getColumnList(this.params.columns);
    if (!columnList.length) {
      // Safety net: render content still stored in the 1.x schema
      // (columnOne..columnFour) when the 2.0 upgrade has not been applied.
      columnList = buildColumnsFromLegacy(this.params);
      if (columnList.length) {
        this.params.columns = columnList;
      }
    }
    this.numColumns = Math.max(2, Math.min(7, columnList.length || 2));
    columnList = columnList.slice(0, this.numColumns);

    this.rawColumns = columnList.map(getColumnCells);
    this.columns = this.rawColumns.map(normalizeCells);
    this.columnTitles = columnList.map(getColumnTitle);

    this.active = null;
    this.previewPoint = null;
    this.connections = [];
    this.correctConnections = [];
    this.connectionCounter = 0;
    this.hasChecked = false;
    this.lastResult = null;
    this.resizeNamespace = '.h5p-column-connector-' + contentId;

    this.correctConnections = this.loadAnswerKey(this.getConfiguredAnswerKey());

    var previousState = this.contentData && this.contentData.previousState;
    if (previousState && $.isArray(previousState.connections)) {
      this.hasChecked = !!previousState.hasChecked;
      this.loadConnections(previousState.connections);
    }
    else {
      this.loadConnections(this.params.predefinedConnections || []);
    }
  }

  ColumnConnector.defaults = {
    layoutMode: 'columns',
    instructions: '<p>Connect the cells to cells in neighboring columns. One cell may be connected to several neighboring column cells.</p>',
    behaviour: {
      lineStyle: 'curved',
      showResetButton: true,
      showCheckButton: true,
      correctConnectionPoints: 1,
      incorrectConnectionPoints: -1,
      missingConnectionPoints: 0
    },
    columns: [],
    predefinedConnections: [],
    correctConnections: [],
    l10n: {
      resetButton: 'Clear connections',
      checkButton: 'Check answer',
      restartButton: 'Restart',
      selected: 'Selected: column @column, cell @cell. Choose a cell in a neighboring column.',
      invalidTarget: 'You can only connect to a cell in a neighboring column.',
      duplicate: 'This connection already exists.',
      emptyColumn: 'There are no cells in this column.',
      resultText: 'Result: @score/@max\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0Points: @points',
      allCorrect: 'All connections are correct.',
      notAllCorrect: 'Correct connections: @correct\u00a0\u00a0\u00a0Incorrect connections: @incorrect\u00a0\u00a0\u00a0Missing connections: @missing',
      noAnswerKey: 'No correct connections have been defined in the authoring view.'
    }
  };


  function getL10n(params) {
    var oldGroup = params.l10n || {};
    var defaults = (ColumnConnector.defaults && ColumnConnector.defaults.l10n) || {};
    var l10n = $.extend(true, {}, defaults, oldGroup);

    Object.keys(defaults).forEach(function (key) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        l10n[key] = params[key];
      }
    });

    return l10n;
  }

  ColumnConnector.prototype = Object.create(EventDispatcher.prototype);
  ColumnConnector.prototype.constructor = ColumnConnector;

  ColumnConnector.prototype.attach = function ($container) {
    var self = this;

    this.$container = $container.empty().addClass('h5p-column-connector-host');
    this.$wrapper = $('<div>', {
      'class': 'h5p-column-connector h5p-cc-layout-' + this.layoutMode,
      'data-columns': this.numColumns,
      'data-layout': this.layoutMode
    });

    var instructionsId = 'h5p-cc-instructions-' + this.contentId;

    this.$instructions = $('<div>', {
      'class': 'h5p-cc-instructions',
      id: instructionsId
    }).html(this.params.instructions || (this.params.behaviour && this.params.behaviour.instructions) || this.params.l10n.instructions || '');

    this.$stage = $('<div>', {
      'class': 'h5p-cc-stage',
      'aria-describedby': instructionsId
    });

    this.$svg = $(document.createElementNS(NS, 'svg'))
      .addClass('h5p-cc-lines')
      .attr({
        focusable: 'false',
        'aria-hidden': 'true'
      });

    this.$columns = $('<div>', {
      'class': 'h5p-cc-columns',
      'data-column-count': this.numColumns
    });

    this.renderColumns();

    this.$live = $('<div>', {
      'class': 'h5p-cc-sr-only',
      'aria-live': 'polite'
    });

    this.$controls = $('<div>', {
      'class': 'h5p-cc-controls'
    });

    if (this.params.behaviour.showResetButton) {
      this.$resetButton = $('<button>', {
        type: 'button',
        'class': 'h5p-joubelui-button h5p-cc-reset',
        text: this.params.l10n.resetButton
      }).on('click', function () {
        self.resetConnections();
      });

      this.$controls.append(this.$resetButton);
    }

    if (this.params.behaviour.showCheckButton) {
      this.$checkButton = $('<button>', {
        type: 'button',
        'class': 'h5p-joubelui-button h5p-cc-check',
        text: this.params.l10n.checkButton
      }).on('click', function () {
        self.checkAnswer(true);
      });

      this.$controls.append(this.$checkButton);
    }

    this.$restartButton = $('<button>', {
      type: 'button',
      'class': 'h5p-joubelui-button h5p-cc-restart',
      text: this.params.l10n.restartButton || 'Restart'
    }).on('click', function () {
      self.restartActivity();
    });

    this.$controls.append(this.$restartButton);

    this.updateCheckButtonState();

    this.$result = $('<div>', {
      'class': 'h5p-cc-result',
      'aria-live': 'polite'
    });

    this.$stage.append(this.$svg, this.$columns);
    this.$wrapper.append(this.$instructions, this.$stage, this.$controls, this.$result, this.$live);
    this.$container.append(this.$wrapper);

    this.bindEvents();

    this.syncColumnTitleHeights();

    if (this.hasChecked && this.connections.length > 0) {
      this.checkAnswer(false);
    }

    this.scheduleInitialResize();
  };

  ColumnConnector.prototype.renderColumns = function () {
    var self = this;
    var hasColumnTitle = this.columnTitles.some(function (title) {
      return !!String(title || '').trim();
    });
    this.$columns.empty();

    $.each(this.columns, function (columnIndex, cells) {
      var title = self.columnTitles[columnIndex] || '';
      var $column = $('<div>', {
        'class': 'h5p-cc-column',
        'data-col': columnIndex
      });

      if (hasColumnTitle) {
        $column.append($('<div>', {
          'class': 'h5p-cc-column-title' + (String(title).trim() ? '' : ' h5p-cc-column-title-empty'),
          text: title,
          'aria-hidden': String(title).trim() ? 'false' : 'true'
        }));
      }

      if (!cells.length) {
        $column.append($('<div>', {
          'class': 'h5p-cc-empty-column',
          text: self.params.l10n.emptyColumn
        }));
      }

      $.each(shuffleIndexes(cells.length), function (displayIndex, rowIndex) {
        var cell = cells[rowIndex];
        var $cell = $('<button>', {
          type: 'button',
          'class': 'h5p-cc-cell',
          'data-col': columnIndex,
          'data-row': rowIndex,
          'aria-pressed': 'false',
          'aria-label': self.getCellAriaLabel(columnIndex, rowIndex, cell)
        });

        var contentClass = 'h5p-cc-cell-content' +
          ' h5p-cc-pos-' + (cell.imagePosition === 'left' ? 'left' : 'above') +
          ' h5p-cc-size-' + cell.imageSize +
          ' h5p-cc-align-' + cell.imageAlign;

        var $content = $('<span>', {
          'class': contentClass
        });

        var imageSrc = getCellImageSource(cell, self.contentId);
        if (imageSrc) {
          $('<img>', {
            'class': 'h5p-cc-cell-image',
            src: imageSrc,
            alt: cell.alt || ''
          }).appendTo($content);
        }

        if (cell.text) {
          $('<span>', {
            'class': 'h5p-cc-cell-text'
          }).html(cell.text).appendTo($content);
        }

        $cell.append($content);
        $column.append($cell);
      });

      self.$columns.append($column);
    });
  };

  ColumnConnector.prototype.bindEvents = function () {
    var self = this;

    this.$columns.on('click', '.h5p-cc-cell', function () {
      var target = readCellPosition($(this));
      self.handleCellClick(target);
    });

    this.$columns.on('keydown', '.h5p-cc-cell', function (event) {
      if (event.key === 'Escape') {
        self.clearActive();
        event.preventDefault();
      }
    });

    this.$stage.on('mousemove touchmove', function (event) {
      if (!self.active) {
        return;
      }

      var point = self.eventToStagePoint(event);
      if (point) {
        self.previewPoint = point;
        self.redraw();
      }
    });

    $(window).off(this.resizeNamespace).on('resize' + this.resizeNamespace, function () {
      self.syncColumnTitleHeights();
      self.redraw();
    });

    if (H5P.externalDispatcher && H5P.externalDispatcher.on) {
      H5P.externalDispatcher.on('resize', function () {
        self.syncColumnTitleHeights();
        self.redraw();
      });
    }
  };

  ColumnConnector.prototype.scheduleInitialResize = function () {
    var self = this;

    this.bindImageResizeHandlers();
    this.startResizeObserver();

    $.each([0, 50, 150, 300, 600, 1200], function (index, delay) {
      self.scheduleContentResize(delay, true);
    });
  };

  ColumnConnector.prototype.bindImageResizeHandlers = function () {
    var self = this;

    if (!this.$wrapper || !this.$wrapper.length) {
      return;
    }

    this.$wrapper.find('img').each(function () {
      var image = this;

      if (image.complete && image.naturalWidth !== 0) {
        return;
      }

      $(image)
        .off('load.h5p-cc-resize error.h5p-cc-resize')
        .one('load.h5p-cc-resize error.h5p-cc-resize', function () {
          self.scheduleContentResize(0, true);
          self.scheduleContentResize(100, false);
        });
    });
  };

  ColumnConnector.prototype.startResizeObserver = function () {
    var self = this;

    if (this.resizeObserver || typeof ResizeObserver === 'undefined' || !this.$wrapper || !this.$wrapper.length) {
      return;
    }

    this.resizeObserver = new ResizeObserver(function () {
      self.scheduleContentResize(80, false);
    });

    this.resizeObserver.observe(this.$wrapper[0]);
  };

  ColumnConnector.prototype.scheduleContentResize = function (delay, force) {
    var self = this;

    window.setTimeout(function () {
      self.performContentResize(!!force);
    }, delay || 0);
  };

  ColumnConnector.prototype.performContentResize = function (force) {
    var element;
    var rect;
    var width;
    var height;

    if (!this.$wrapper || !this.$wrapper.length) {
      return;
    }

    this.syncColumnTitleHeights();
    this.redraw();

    element = this.$wrapper[0];
    rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
    width = Math.ceil((rect && rect.width) || element.offsetWidth || 0);
    height = Math.ceil((rect && rect.height) || element.scrollHeight || element.offsetHeight || 0);

    if (!force && Math.abs(width - (this.lastResizeWidth || 0)) <= 1 && Math.abs(height - (this.lastResizeHeight || 0)) <= 1) {
      return;
    }

    this.lastResizeWidth = width;
    this.lastResizeHeight = height;
    this.trigger('resize');
  };


  ColumnConnector.prototype.syncColumnTitleHeights = function () {
    var maxHeight = 0;
    var $titles;

    if (!this.$columns || !this.$columns.length) {
      return;
    }

    $titles = this.$columns.find('.h5p-cc-column-title');

    if (!$titles.length) {
      return;
    }

    $titles.css('min-height', '');

    $titles.each(function () {
      maxHeight = Math.max(maxHeight, this.getBoundingClientRect().height);
    });

    if (maxHeight > 0) {
      $titles.css('min-height', Math.ceil(maxHeight) + 'px');
    }
  };

  ColumnConnector.prototype.handleCellClick = function (target) {
    if (this.hasChecked) {
      return;
    }

    if (!this.active) {
      this.selectCell(target);
      return;
    }

    if (isSamePosition(this.active, target)) {
      this.clearActive();
      return;
    }

    if (!this.isAdjacent(this.active, target)) {
      this.announce(this.params.l10n.invalidTarget);
      return;
    }

    this.addConnection(this.active, target);
    this.clearActive();
  };

  ColumnConnector.prototype.selectCell = function (position) {
    this.active = position;
    this.previewPoint = null;
    this.$columns.find('.h5p-cc-cell')
      .removeClass('h5p-cc-cell-selected h5p-cc-cell-valid-target')
      .attr('aria-pressed', 'false');

    var $selected = this.findCell(position)
      .addClass('h5p-cc-cell-selected')
      .attr('aria-pressed', 'true');

    this.$columns.find('.h5p-cc-cell').each(function () {
      var $cell = $(this);
      var candidate = readCellPosition($cell);
      if (Math.abs(candidate.col - position.col) === 1) {
        $cell.addClass('h5p-cc-cell-valid-target');
      }
    });

    this.announce(format(this.params.l10n.selected, {
      column: position.col + 1,
      cell: position.row + 1
    }));

    $selected.focus();
    this.redraw();
  };

  ColumnConnector.prototype.clearActive = function () {
    this.active = null;
    this.previewPoint = null;
    if (this.$columns) {
      this.$columns.find('.h5p-cc-cell')
        .removeClass('h5p-cc-cell-selected h5p-cc-cell-valid-target')
        .attr('aria-pressed', 'false');
    }
    this.redraw();
  };

  ColumnConnector.prototype.addConnection = function (from, to) {
    var connection;

    if (!this.isValidPosition(from) || !this.isValidPosition(to) || !this.isAdjacent(from, to)) {
      this.announce(this.params.l10n.invalidTarget);
      return false;
    }

    connection = {
      id: 'h5p-cc-connection-' + (++this.connectionCounter),
      from: clonePosition(from),
      to: clonePosition(to)
    };

    if (this.hasDuplicate(connection)) {
      this.announce(this.params.l10n.duplicate);
      return false;
    }

    this.connections.push(connection);
    this.clearCheckState(true);
    this.updateCheckButtonState();
    this.redraw();
    this.trigger('resize');
    return true;
  };

  ColumnConnector.prototype.hasDuplicate = function (connection) {
    var key = this.getConnectionKey(connection);
    return this.connections.some(function (existing) {
      return key === this.getConnectionKey(existing);
    }, this);
  };

  ColumnConnector.prototype.removeConnection = function (connectionId) {
    this.connections = this.connections.filter(function (connection) {
      return connection.id !== connectionId;
    });
    this.clearCheckState(true);
    this.updateCheckButtonState();
    this.redraw();
    this.trigger('resize');
  };

  ColumnConnector.prototype.resetConnections = function () {
    this.connections = [];
    this.clearCheckState(true);
    this.updateCheckButtonState();
    this.clearActive();
    this.scheduleContentResize(0, true);
  };


  ColumnConnector.prototype.redraw = function () {
    var self = this;

    if (!this.$stage || !this.$svg || !this.$stage.length || !this.$stage[0].getBoundingClientRect) {
      return;
    }

    var stageRect = this.$stage[0].getBoundingClientRect();
    var width = Math.max(1, stageRect.width);
    var height = Math.max(1, stageRect.height);

    this.$svg.attr({
      width: width,
      height: height,
      viewBox: '0 0 ' + width + ' ' + height
    });

    this.$svg.empty();

    $.each(this.connections, function (index, connection) {
      var endpoints = self.getConnectionEndpoints(connection.from, connection.to);

      if (!endpoints) {
        return;
      }

      var className = 'h5p-cc-line';
      if (self.hasChecked && connection.status) {
        className += ' h5p-cc-line-' + connection.status;
      }

      self.drawPath(endpoints.start, endpoints.end, className, connection.id);

      if (self.hasChecked && connection.status) {
        self.drawFeedbackIcon(endpoints.start, endpoints.end, connection.status);
      }
    });

    if (this.hasChecked && this.lastResult && this.lastResult.missingConnections) {
      $.each(this.lastResult.missingConnections, function (index, connection) {
        var endpoints = self.getConnectionEndpoints(connection.from, connection.to);

        if (!endpoints) {
          return;
        }

        self.drawPath(endpoints.start, endpoints.end, 'h5p-cc-line h5p-cc-line-missing');
      });
    }

    if (this.active && this.previewPoint) {
      var previewStart = this.getCellEdgePoint(this.active, this.previewPoint);
      if (previewStart) {
        this.drawPath(previewStart, this.previewPoint, 'h5p-cc-line-preview');
      }
    }
  };

  ColumnConnector.prototype.drawPath = function (start, end, className, connectionId) {
    var path = document.createElementNS(NS, 'path');
    var d = this.getPathDefinition(start, end);

    path.setAttribute('d', d);
    path.setAttribute('class', className);

    if (connectionId) {
      path.setAttribute('data-connection-id', connectionId);

      if (!this.hasChecked) {
        var self = this;
        path.setAttribute('role', 'button');
        path.addEventListener('click', function (event) {
          event.preventDefault();
          self.removeConnection(connectionId);
        });
      }
      else {
        path.setAttribute('aria-hidden', 'true');
      }
    }

    this.$svg.append(path);
  };

  ColumnConnector.prototype.drawFeedbackIcon = function (start, end, status) {
    var point = this.getPathMidpoint(start, end);
    var group = document.createElementNS(NS, 'g');
    var circle = document.createElementNS(NS, 'circle');
    var text = document.createElementNS(NS, 'text');
    var icon = status === 'correct' ? '✓' : '×';

    group.setAttribute('class', 'h5p-cc-feedback-icon h5p-cc-feedback-icon-' + status);
    group.setAttribute('aria-hidden', 'true');
    group.setAttribute('transform', 'translate(' + point.x + ' ' + point.y + ')');

    circle.setAttribute('r', '11');
    circle.setAttribute('cx', '0');
    circle.setAttribute('cy', '0');

    text.setAttribute('x', '0');
    text.setAttribute('y', '0');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.textContent = icon;

    group.appendChild(circle);
    group.appendChild(text);
    this.$svg.append(group);
  };

  ColumnConnector.prototype.getPathDefinition = function (start, end) {
    if (this.params.behaviour.lineStyle === 'straight') {
      return 'M ' + start.x + ' ' + start.y + ' L ' + end.x + ' ' + end.y;
    }

    if (this.layoutMode === 'rows') {
      var verticalDelta = Math.abs(end.y - start.y);
      var verticalControlDistance = Math.max(40, verticalDelta * 0.45);
      var verticalDirection = end.y >= start.y ? 1 : -1;
      var c1y = start.y + (verticalControlDistance * verticalDirection);
      var c2y = end.y - (verticalControlDistance * verticalDirection);

      return 'M ' + start.x + ' ' + start.y +
        ' C ' + start.x + ' ' + c1y +
        ', ' + end.x + ' ' + c2y +
        ', ' + end.x + ' ' + end.y;
    }

    var delta = Math.abs(end.x - start.x);
    var controlDistance = Math.max(40, delta * 0.45);
    var direction = end.x >= start.x ? 1 : -1;
    var c1x = start.x + (controlDistance * direction);
    var c2x = end.x - (controlDistance * direction);

    return 'M ' + start.x + ' ' + start.y +
      ' C ' + c1x + ' ' + start.y +
      ', ' + c2x + ' ' + end.y +
      ', ' + end.x + ' ' + end.y;
  };

  ColumnConnector.prototype.getPathMidpoint = function (start, end) {
    if (this.params.behaviour.lineStyle === 'straight') {
      return {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2
      };
    }

    var t = 0.5;

    if (this.layoutMode === 'rows') {
      var verticalDelta = Math.abs(end.y - start.y);
      var verticalControlDistance = Math.max(40, verticalDelta * 0.45);
      var verticalDirection = end.y >= start.y ? 1 : -1;
      var verticalC1 = {
        x: start.x,
        y: start.y + (verticalControlDistance * verticalDirection)
      };
      var verticalC2 = {
        x: end.x,
        y: end.y - (verticalControlDistance * verticalDirection)
      };

      return {
        x: cubicBezier(start.x, verticalC1.x, verticalC2.x, end.x, t),
        y: cubicBezier(start.y, verticalC1.y, verticalC2.y, end.y, t)
      };
    }

    var delta = Math.abs(end.x - start.x);
    var controlDistance = Math.max(40, delta * 0.45);
    var direction = end.x >= start.x ? 1 : -1;
    var c1 = {
      x: start.x + (controlDistance * direction),
      y: start.y
    };
    var c2 = {
      x: end.x - (controlDistance * direction),
      y: end.y
    };

    return {
      x: cubicBezier(start.x, c1.x, c2.x, end.x, t),
      y: cubicBezier(start.y, c1.y, c2.y, end.y, t)
    };
  };

  ColumnConnector.prototype.getConnectionEndpoints = function (from, to) {
    var start = this.getCellEdgePoint(from, to);
    var end = this.getCellEdgePoint(to, from);

    if (!start || !end) {
      return null;
    }

    return {
      start: start,
      end: end
    };
  };

  ColumnConnector.prototype.getCellEdgePoint = function (position, other) {
    var $cell = this.findCell(position);
    var otherPoint;
    var rect;
    var stageRect;
    var centerX;
    var centerY;

    if (!$cell.length || !this.$stage || !this.$stage.length) {
      return null;
    }

    rect = $cell[0].getBoundingClientRect();
    stageRect = this.$stage[0].getBoundingClientRect();
    centerX = rect.left + (rect.width / 2) - stageRect.left;
    centerY = rect.top + (rect.height / 2) - stageRect.top;

    if (other && typeof other.x === 'number') {
      otherPoint = other;
    }
    else {
      otherPoint = this.getCellCenter(other);
    }

    if (this.layoutMode === 'rows') {
      return {
        x: centerX,
        y: otherPoint && otherPoint.y < centerY ? rect.top - stageRect.top : rect.bottom - stageRect.top
      };
    }

    return {
      x: otherPoint && otherPoint.x < centerX ? rect.left - stageRect.left : rect.right - stageRect.left,
      y: centerY
    };
  };

  ColumnConnector.prototype.getCellCenter = function (position) {
    var $cell = this.findCell(position);
    if (!$cell.length || !this.$stage || !this.$stage.length) {
      return null;
    }

    var rect = $cell[0].getBoundingClientRect();
    var stageRect = this.$stage[0].getBoundingClientRect();

    return {
      x: rect.left + (rect.width / 2) - stageRect.left,
      y: rect.top + (rect.height / 2) - stageRect.top
    };
  };

  ColumnConnector.prototype.eventToStagePoint = function (event) {
    var original = event.originalEvent || event;
    var source = original.touches && original.touches.length ? original.touches[0] : original;
    var stageRect;

    if (!source || !this.$stage || !this.$stage.length) {
      return null;
    }

    stageRect = this.$stage[0].getBoundingClientRect();

    return {
      x: source.clientX - stageRect.left,
      y: source.clientY - stageRect.top
    };
  };

  ColumnConnector.prototype.findCell = function (position) {
    return this.$columns.find(
      '.h5p-cc-cell[data-col="' + position.col + '"][data-row="' + position.row + '"]'
    );
  };

  ColumnConnector.prototype.isAdjacent = function (from, to) {
    return Math.abs(from.col - to.col) === 1;
  };

  ColumnConnector.prototype.isValidPosition = function (position) {
    return !!(
      position &&
      position.col >= 0 &&
      position.col < this.columns.length &&
      position.row >= 0 &&
      this.columns[position.col] &&
      position.row < this.columns[position.col].length
    );
  };

  ColumnConnector.prototype.loadConnections = function (connections) {
    var self = this;

    $.each(connections || [], function (index, item) {
      var connection = self.normalizeConnection(item);
      if (!connection) {
        return;
      }

      if (self.hasDuplicate(connection)) {
        return;
      }

      self.connections.push(connection);
    });
  };


  ColumnConnector.prototype.getConfiguredAnswerKey = function () {
    var cellFieldAnswerKey = this.buildAnswerKeyFromCellFields();

    if (cellFieldAnswerKey.length) {
      return cellFieldAnswerKey;
    }

    return this.params.correctConnections || [];
  };

  ColumnConnector.prototype.buildAnswerKeyFromCellFields = function () {
    var self = this;
    var answerKey = [];
    var columnList = getColumnList(this.params.columns).slice(0, this.numColumns);

    $.each(columnList, function (columnIndex, column) {
      if (columnIndex === 0) {
        return;
      }

      $.each(getColumnCells(column), function (rowIndex, cell) {
        $.each(self.parseSelectedCellIndices(cell && cell.correctToPrevious), function (index, oneBasedTargetRow) {
          answerKey.push({
            fromColumn: String(columnIndex + 1),
            fromIndex: rowIndex + 1,
            toColumn: String(columnIndex),
            toIndex: oneBasedTargetRow
          });
        });
      });
    });

    return answerKey;
  };

  ColumnConnector.prototype.parseSelectedCellIndices = function (value) {
    var parsed;
    var result = [];
    var seen = {};

    if ($.isArray(value)) {
      parsed = value;
    }
    else if (typeof value === 'number') {
      parsed = [value];
    }
    else if (typeof value === 'string' && value.trim()) {
      try {
        parsed = JSON.parse(value);
      }
      catch (e) {
        parsed = value.split(',');
      }
    }
    else {
      parsed = [];
    }

    if (!$.isArray(parsed)) {
      parsed = [parsed];
    }

    $.each(parsed, function (index, item) {
      var number = parseInt(item, 10);

      if (number > 0 && !seen[number]) {
        seen[number] = true;
        result.push(number);
      }
    });

    return result;
  };

  ColumnConnector.prototype.parseAnswerKeyByCells = function (value) {
    if ($.isArray(value)) {
      return value;
    }

    if (typeof value !== 'string' || !value.trim()) {
      return [];
    }

    try {
      var parsed = JSON.parse(value);
      return $.isArray(parsed) ? parsed : [];
    }
    catch (e) {
      return [];
    }
  };

  ColumnConnector.prototype.loadAnswerKey = function (connections) {
    var self = this;
    var seen = {};
    var answerKey = [];

    $.each(connections || [], function (index, item) {
      var connection = self.normalizeConnectionPair(item);
      var key;

      if (!connection) {
        return;
      }

      key = self.getConnectionKey(connection);
      if (seen[key]) {
        return;
      }

      seen[key] = true;
      answerKey.push(connection);
    });

    return answerKey;
  };

  ColumnConnector.prototype.normalizeConnection = function (item) {
    var pair = this.normalizeConnectionPair(item);

    if (!pair) {
      return null;
    }

    return {
      id: 'h5p-cc-connection-' + (++this.connectionCounter),
      from: pair.from,
      to: pair.to,
      status: null
    };
  };

  ColumnConnector.prototype.normalizeConnectionPair = function (item) {
    item = item || {};

    var from = {
      col: parseInt(item.fromColumn || item.fromCol || (item.from && item.from.col + 1), 10) - 1,
      row: parseInt(item.fromIndex || item.fromRow || (item.from && item.from.row + 1), 10) - 1
    };
    var to = {
      col: parseInt(item.toColumn || item.toCol || (item.to && item.to.col + 1), 10) - 1,
      row: parseInt(item.toIndex || item.toRow || (item.to && item.to.row + 1), 10) - 1
    };

    if (!this.isValidPosition(from) || !this.isValidPosition(to) || !this.isAdjacent(from, to)) {
      return null;
    }

    return {
      from: from,
      to: to
    };
  };

  ColumnConnector.prototype.getConnectionKey = function (connection) {
    var first = connection.from;
    var second = connection.to;

    if (comparePositions(second, first) < 0) {
      first = connection.to;
      second = connection.from;
    }

    return first.col + ':' + first.row + '-' + second.col + ':' + second.row;
  };

  ColumnConnector.prototype.getCurrentState = function () {
    return {
      connections: this.connections.map(function (connection) {
        return {
          fromColumn: connection.from.col + 1,
          fromIndex: connection.from.row + 1,
          toColumn: connection.to.col + 1,
          toIndex: connection.to.row + 1
        };
      }),
      hasChecked: this.hasChecked
    };
  };

  ColumnConnector.prototype.updateControlButtons = function () {
    var hasChecked = !!this.hasChecked;

    if (this.$resetButton) {
      this.$resetButton.toggle(!hasChecked);
    }

    if (this.$checkButton) {
      this.$checkButton
        .toggle(!hasChecked)
        .prop('disabled', this.connections.length === 0);
    }

    if (this.$restartButton) {
      this.$restartButton.toggle(hasChecked);
    }
  };

  ColumnConnector.prototype.updateCheckButtonState = function () {
    this.updateControlButtons();
    this.updateInteractionLock();
  };

  ColumnConnector.prototype.updateInteractionLock = function () {
    var locked = !!this.hasChecked;

    if (this.$wrapper) {
      this.$wrapper.toggleClass('h5p-cc-checked', locked);
    }

    if (this.$columns) {
      this.$columns.find('.h5p-cc-cell')
        .prop('disabled', locked)
        .attr('aria-disabled', locked ? 'true' : 'false');

      if (locked) {
        this.$columns.find('.h5p-cc-cell')
          .removeClass('h5p-cc-cell-selected h5p-cc-cell-valid-target')
          .attr('aria-pressed', 'false');
      }
    }
  };

  ColumnConnector.prototype.checkAnswer = function (emitXAPI) {
    var result;

    if (this.connections.length === 0) {
      this.updateCheckButtonState();
      return null;
    }

    result = this.evaluateAnswer();

    this.hasChecked = true;
    this.lastResult = result;
    this.clearActive();
    this.applyCheckResult(result);
    this.updateResultMessage(result);
    this.updateCheckButtonState();
    this.redraw();
    this.announce(this.getResultAnnouncement(result));
    this.scheduleContentResize(0, true);
    this.scheduleContentResize(100, false);

    if (emitXAPI !== false) {
      this.emitXAPIResult(result);
    }

    return result;
  };

  ColumnConnector.prototype.getScoringSettings = function () {
    var behaviour = this.params.behaviour || {};

    function toNumber(value, fallback) {
      var number = parseFloat(value);
      return isNaN(number) ? fallback : number;
    }

    return {
      correct: toNumber(behaviour.correctConnectionPoints, 1),
      incorrect: toNumber(behaviour.incorrectConnectionPoints, -1),
      missing: toNumber(behaviour.missingConnectionPoints, 0)
    };
  };

  ColumnConnector.prototype.evaluateAnswer = function () {
    var self = this;
    var correctMap = {};
    var seenCorrect = {};
    var connectionResults = {};
    var score = 0;
    var incorrect = 0;
    var missingConnections = [];
    var scoring = this.getScoringSettings();
    var rawPoints;
    var points;
    var maxPoints;

    $.each(this.correctConnections, function (index, connection) {
      correctMap[self.getConnectionKey(connection)] = true;
    });

    $.each(this.connections, function (index, connection) {
      var key = self.getConnectionKey(connection);

      if (correctMap[key] && !seenCorrect[key]) {
        seenCorrect[key] = true;
        connectionResults[connection.id] = 'correct';
        score++;
      }
      else {
        connectionResults[connection.id] = 'incorrect';
        incorrect++;
      }
    });

    $.each(this.correctConnections, function (index, connection) {
      var key = self.getConnectionKey(connection);

      if (!seenCorrect[key]) {
        missingConnections.push(connection);
      }
    });

    var maxScore = this.correctConnections.length;
    var missing = missingConnections.length;
    var hasAnswerKey = maxScore > 0;

    rawPoints = (score * scoring.correct) + (incorrect * scoring.incorrect) + (missing * scoring.missing);
    points = Math.max(0, rawPoints);
    maxPoints = Math.max(0, maxScore * scoring.correct, points);

    return {
      score: score,
      maxScore: maxScore,
      points: points,
      rawPoints: rawPoints,
      maxPoints: maxPoints,
      incorrect: incorrect,
      missing: missing,
      missingConnections: missingConnections,
      hasAnswerKey: hasAnswerKey,
      success: hasAnswerKey && score === maxScore && incorrect === 0,
      connectionResults: connectionResults
    };
  };

  ColumnConnector.prototype.applyCheckResult = function (result) {
    $.each(this.connections, function (index, connection) {
      connection.status = result.connectionResults[connection.id] || null;
    });
  };

  ColumnConnector.prototype.clearCheckState = function (silent) {
    this.hasChecked = false;
    this.lastResult = null;

    $.each(this.connections, function (index, connection) {
      connection.status = null;
    });

    if (!silent) {
      this.updateResultMessage(null);
        this.redraw();
    }
    else if (this.$result) {
      this.updateResultMessage(null);
    }
  };

  ColumnConnector.prototype.updateResultMessage = function (result) {
    var $score;
    var $details;

    if (!this.$result) {
      return;
    }

    this.$result
      .empty()
      .removeClass('h5p-cc-result-success h5p-cc-result-failure h5p-cc-result-no-key');

    if (!result) {
      return;
    }

    if (!result.hasAnswerKey) {
      this.$result
        .addClass('h5p-cc-result-no-key')
        .text(this.params.l10n.noAnswerKey);
      return;
    }

    $score = $('<div>', {
      'class': 'h5p-cc-result-score'
    }).appendTo(this.$result);

    $('<span>', {
      text: format(this.params.l10n.resultText, {
        score: result.score,
        max: result.maxScore,
        points: result.points
      })
    }).appendTo($score);

    if (result.success) {
      $('<div>', {
        'class': 'h5p-cc-result-detail',
        text: this.params.l10n.allCorrect
      }).appendTo(this.$result);
    }
    else {
      $details = $('<div>', {
        'class': 'h5p-cc-result-detail'
      }).appendTo(this.$result);

      $details.text(format(this.params.l10n.notAllCorrect, {
        correct: result.score,
        incorrect: result.incorrect,
        missing: result.missing
      }));
    }

    this.$result.addClass(result.success ? 'h5p-cc-result-success' : 'h5p-cc-result-failure');
  };

  ColumnConnector.prototype.getResultAnnouncement = function (result) {
    if (!result.hasAnswerKey) {
      return this.params.l10n.noAnswerKey;
    }

    return format(this.params.l10n.resultText, {
      score: result.score,
      max: result.maxScore,
      points: result.points
    }) + ' ' + (result.success ? this.params.l10n.allCorrect : format(this.params.l10n.notAllCorrect, {
      correct: result.score,
      incorrect: result.incorrect,
      missing: result.missing
    }));
  };

  ColumnConnector.prototype.getScore = function () {
    return this.lastResult ? this.lastResult.points : 0;
  };

  ColumnConnector.prototype.getMaxScore = function () {
    var scoring = this.getScoringSettings();
    return Math.max(0, this.correctConnections.length * scoring.correct);
  };

  ColumnConnector.prototype.getAnswerGiven = function () {
    return this.connections.length > 0;
  };

  ColumnConnector.prototype.restartActivity = function () {
    this.connections = [];
    this.connectionCounter = 0;
    this.hasChecked = false;
    this.lastResult = null;
    this.clearActive();

    if (this.$columns) {
      this.renderColumns();
    }

    this.updateResultMessage(null);
    this.updateCheckButtonState();

    this.scheduleInitialResize();
  };

  ColumnConnector.prototype.resetTask = function () {
    this.restartActivity();
  };

  ColumnConnector.prototype.getXAPIData = function () {
    var event = this.getXAPIAnswerEvent();

    return event ? {
      statement: event.data.statement
    } : null;
  };

  ColumnConnector.prototype.getXAPIAnswerEvent = function (result) {
    var event;

    result = result || this.lastResult || this.evaluateAnswer();

    if (!result.hasAnswerKey) {
      return null;
    }

    event = this.createXAPIEvent('answered');
    if (!event) {
      return null;
    }

    if (event.setScoredResult) {
      event.setScoredResult(result.points, result.maxPoints, this, true, result.success);
    }

    event.data.statement.result.response = this.getXAPIResponse();

    return event;
  };

  ColumnConnector.prototype.createXAPIEvent = function (verb) {
    var event;
    var definition;

    if (!this.createXAPIEventTemplate) {
      return null;
    }

    event = this.createXAPIEventTemplate(verb);
    definition = event.getVerifiedStatementValue(['object', 'definition']);
    $.extend(definition, this.getxAPIDefinition());

    return event;
  };

  ColumnConnector.prototype.getxAPIDefinition = function () {
    var languageTag = this.getLanguageTag();
    var definition = {
      name: {},
      description: {},
      type: 'http://adlnet.gov/expapi/activities/cmi.interaction',
      interactionType: 'matching',
      correctResponsesPattern: [this.getXAPIConnectionPattern(this.correctConnections)],
      source: this.getXAPICells(),
      target: this.getXAPICells()
    };

    definition.name[languageTag] = this.getTitle();
    definition.name['en-US'] = definition.name[languageTag];
    definition.description[languageTag] = this.getDescription();
    definition.description['en-US'] = definition.description[languageTag];

    return definition;
  };

  ColumnConnector.prototype.getXAPIResponse = function () {
    return this.getXAPIConnectionPattern(this.connections);
  };

  ColumnConnector.prototype.getXAPIConnectionPattern = function (connections) {
    var self = this;

    return (connections || []).map(function (connection) {
      var normalized = self.getNormalizedConnectionPositions(connection);

      return self.getXAPICellId(normalized.from) + '[.]' + self.getXAPICellId(normalized.to);
    }).sort().join('[,]');
  };

  ColumnConnector.prototype.getNormalizedConnectionPositions = function (connection) {
    var from = clonePosition(connection.from);
    var to = clonePosition(connection.to);

    if (comparePositions(to, from) < 0) {
      return {
        from: to,
        to: from
      };
    }

    return {
      from: from,
      to: to
    };
  };

  ColumnConnector.prototype.getXAPICells = function () {
    var self = this;
    var cells = [];

    $.each(this.columns, function (columnIndex, column) {
      $.each(column, function (rowIndex, cell) {
        var description = {};
        var position = {
          col: columnIndex,
          row: rowIndex
        };

        description[self.getLanguageTag()] = self.getXAPICellDescription(columnIndex, rowIndex, cell);
        description['en-US'] = description[self.getLanguageTag()];

        cells.push({
          id: self.getXAPICellId(position),
          description: description
        });
      });
    });

    return cells;
  };

  ColumnConnector.prototype.getXAPICellId = function (position) {
    return 'c' + (position.col + 1) + 'r' + (position.row + 1);
  };

  ColumnConnector.prototype.getXAPICellDescription = function (columnIndex, rowIndex, cell) {
    var title = this.columnTitles[columnIndex] || ((columnIndex + 1) + '.');
    var text = stripTags(cell.text || '').trim();
    var alt = stripTags(cell.alt || '').trim();

    return title + ' / ' + (rowIndex + 1) + ': ' + (text || alt || this.getXAPICellId({
      col: columnIndex,
      row: rowIndex
    }));
  };

  ColumnConnector.prototype.getTitle = function () {
    var metadata = this.contentData && this.contentData.metadata;
    var title = metadata && metadata.title ? metadata.title : 'Connect with Lines';

    return H5P.createTitle ? H5P.createTitle(title) : title;
  };

  ColumnConnector.prototype.getDescription = function () {
    return stripTags(this.params.instructions || (this.params.behaviour && this.params.behaviour.instructions) || this.getTitle()).replace(/\s+/g, ' ').trim();
  };

  ColumnConnector.prototype.getLanguageTag = function () {
    var metadata = this.contentData && this.contentData.metadata;
    var language = (metadata && (metadata.defaultLanguage || metadata.language)) || 'en';
    var parts = String(language).replace('_', '-').split('-');

    if (!parts[0]) {
      return 'en-US';
    }

    parts[0] = parts[0].toLowerCase();
    if (parts[1]) {
      parts[1] = parts[1].toUpperCase();
    }

    return parts.length === 1 ? parts[0] : parts.join('-');
  };

  ColumnConnector.prototype.emitXAPIResult = function (result) {
    var event;

    try {
      event = this.getXAPIAnswerEvent(result);
      if (event) {
        this.trigger(event);
      }
    }
    catch (e) {
      // Older H5P integrations may not expose xAPI helpers for custom libraries.
    }
  };

  ColumnConnector.prototype.getCellAriaLabel = function (columnIndex, rowIndex, cell) {
    var text = stripTags(cell.text || '').trim();
    var alt = cell.alt || '';
    var content = text || alt || '';
    return ((columnIndex + 1) + '. tulp, ' + (rowIndex + 1) + '. lahter' + (content ? ': ' + content : ''));
  };


  ColumnConnector.prototype.announce = function (message) {
    if (this.$live) {
      this.$live.text(message);
    }
  };

  function getCellImageSource(cell, contentId) {
    var url;

    if (cell.imageFile && cell.imageFile.path) {
      return H5P.getPath(cell.imageFile.path, contentId);
    }

    url = $.trim(cell.imageUrl || '');
    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    return null;
  }

  function shuffleIndexes(length) {
    var indexes = [];
    var i;
    var j;
    var temp;

    for (i = 0; i < length; i++) {
      indexes.push(i);
    }

    for (i = indexes.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      temp = indexes[i];
      indexes[i] = indexes[j];
      indexes[j] = temp;
    }

    return indexes;
  }

  function normalizeCells(cells) {
    return ($.isArray(cells) ? cells : []).map(function (cell) {
      cell = cell || {};
      var image = cell.image || {};
      var extra = image.imageExtra || {};
      return {
        text: cell.text || '',
        imageFile: image.file || null,
        imageUrl: extra.url || cell.url || image.url || '',
        imagePosition: image.position === 'left' ? 'left' : 'above',
        imageSize: normalizeImageSize(image.size),
        imageAlign: image.align === 'left' ? 'left' : 'center',
        alt: extra.alt || cell.alt || image.alt || ''
      };
    });
  }

  function normalizeImageSize(size) {
    if (size === 'medium' || size === 'small' || size === 'large') {
      return size;
    }

    return 'large';
  }

  function getColumnList(columnsParam) {
    if ($.isArray(columnsParam)) {
      return columnsParam;
    }

    if (columnsParam && $.isArray(columnsParam.columns)) {
      return columnsParam.columns;
    }

    return [];
  }

  // Reconstruct the 2.0 columns list from legacy 1.x parameters
  // (columnOne..columnFour + flat image fields + correctToColumnN answer key).
  // Used only as a fallback so un-upgraded content is not lost.
  function buildColumnsFromLegacy(params) {
    if (!params) {
      return [];
    }
    var COLUMN_KEYS = ['columnOne', 'columnTwo', 'columnThree', 'columnFour'];
    var TITLE_KEYS = ['columnOneTitle', 'columnTwoTitle', 'columnThreeTitle', 'columnFourTitle'];
    var CORRECT_KEYS = ['correctToColumnOne', 'correctToColumnTwo', 'correctToColumnThree'];

    var declared = parseInt(params.behaviour && params.behaviour.columns, 10);
    if (isNaN(declared) || declared < 2) {
      var highest = 0;
      for (var j = 0; j < COLUMN_KEYS.length; j++) {
        var c = params[COLUMN_KEYS[j]];
        if (c && ((c.cells && c.cells.length) || c.title)) {
          highest = j + 1;
        }
      }
      declared = highest;
    }
    var count = declared;
    if (!count) {
      return [];
    }
    count = Math.max(2, Math.min(4, count));

    var columns = [];
    for (var i = 0; i < count; i++) {
      var legacy = params[COLUMN_KEYS[i]] || {};
      var legacyCells = $.isArray(legacy.cells) ? legacy.cells : [];
      var cells = [];
      for (var k = 0; k < legacyCells.length; k++) {
        var oldCell = legacyCells[k] || {};
        var position = oldCell.imagePosition === 'left' ? 'left' : 'above';
        var size = position === 'left' ? (oldCell.imageLeftSize === 'medium' ? 'medium' : 'small') : 'large';
        var image = { position: position, size: size, align: 'left' };
        if (oldCell.image) { image.file = oldCell.image; }
        var extra = {};
        if (oldCell.imageUrl) { extra.url = oldCell.imageUrl; }
        if (oldCell.alt) { extra.alt = oldCell.alt; }
        if (extra.url || extra.alt) { image.imageExtra = extra; }
        var newCell = { text: oldCell.text || '', image: image };
        if (i >= 1) {
          var value = oldCell[CORRECT_KEYS[i - 1]];
          if (value !== undefined && value !== null && value !== '') {
            newCell.correctToPrevious = value;
          }
        }
        cells.push(newCell);
      }
      columns.push({ title: legacy.title || params[TITLE_KEYS[i]] || '', cells: cells });
    }
    return columns;
  }

  function getColumnCells(columnParam) {
    if ($.isArray(columnParam)) {
      return columnParam;
    }

    if (columnParam && $.isArray(columnParam.cells)) {
      return columnParam.cells;
    }

    return [];
  }

  function getColumnTitle(columnParam) {
    if (columnParam && !$.isArray(columnParam) && columnParam.title !== undefined) {
      return columnParam.title || '';
    }

    return '';
  }

  function readCellPosition($cell) {
    return {
      col: parseInt($cell.attr('data-col'), 10),
      row: parseInt($cell.attr('data-row'), 10)
    };
  }

  function clonePosition(position) {
    return {
      col: position.col,
      row: position.row
    };
  }

  function isSamePosition(a, b) {
    return a && b && a.col === b.col && a.row === b.row;
  }

  function comparePositions(a, b) {
    if (a.col !== b.col) {
      return a.col - b.col;
    }

    return a.row - b.row;
  }

  function format(template, values) {
    var output = template || '';
    $.each(values, function (key, value) {
      output = output.replace(new RegExp('@' + key, 'g'), value);
    });
    return output;
  }

  function cubicBezier(p0, p1, p2, p3, t) {
    var oneMinusT = 1 - t;
    return (oneMinusT * oneMinusT * oneMinusT * p0) +
      (3 * oneMinusT * oneMinusT * t * p1) +
      (3 * oneMinusT * t * t * p2) +
      (t * t * t * p3);
  }

  function stripTags(value) {
    return String(value || '').replace(/<[^>]*>/g, ' ');
  }

  return ColumnConnector;
})(H5P.jQuery, H5P.EventDispatcher);
