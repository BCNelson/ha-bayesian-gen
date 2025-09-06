export interface ChartConfig {
  height: number
  threshold: number
  showSensorValues?: boolean
  sensorDataRange?: { min: number; max: number }
}

export const createBayesianChartOptions = (config: ChartConfig) => {
  const options = {
  chart: {
    id: 'bayesian-probability',
    type: 'line',
    height: config.height,
    animations: {
      enabled: false, // Disable animations for better performance
      easing: 'easeinout',
      speed: 200
    },
    toolbar: {
      show: true,
      tools: {
        download: true,
        selection: true,
        zoom: true,
        zoomin: true,
        zoomout: true,
        pan: true,
        reset: true
      }
    },
    zoom: {
      enabled: true,
      type: 'x',
      autoScaleYaxis: true
    }
  },
  stroke: {
    curve: 'stepline',
    width: config.showSensorValues ? [2, 2, 2, 3] : [2, 2, 2],
    dashArray: config.showSensorValues ? [0, 0, 5, 0] : [0, 0, 5]
  },
  xaxis: {
    title: {
      text: 'Time'
    },
    type: 'datetime',
    labels: {
      datetimeUTC: false,
      format: 'HH:mm'
    }
  },
  yaxis: config.showSensorValues ? [
    {
      seriesName: ['Probability', 'Sensor State (ON/OFF)', 'Desired State'],
      title: {
        text: 'Probability (%)'
      },
      min: 0,
      max: 100,
      labels: {
        formatter: (value: number) => `${value.toFixed(0)}%`
      }
    },
    {
      seriesName: ['Value'],
      opposite: true,
      title: {
        text: 'Sensor Value'
      },
      min: config.sensorDataRange?.min,
      max: config.sensorDataRange?.max,
      labels: {
        formatter: (value: number) => value.toFixed(1)
      }
    }
  ] : {
    title: {
      text: 'Probability (%)'
    },
    min: 0,
    max: 100,
    labels: {
      formatter: (value: number) => `${value.toFixed(0)}%`
    }
  },
  annotations: {
    yaxis: [
      {
        y: config.threshold * 100,
        borderColor: '#D32F2F',
        borderWidth: 2,
        strokeDashArray: 8,
        label: {
          borderColor: '#D32F2F',
          style: {
            color: '#fff',
            background: '#D32F2F',
            fontSize: '12px',
            fontWeight: 600
          },
          text: `Threshold (${(config.threshold * 100).toFixed(0)}%)`,
          position: 'left'
        }
      }
    ]
  },
  colors: config.showSensorValues ? ['#2E7D32', '#9C27B0', '#FFC107', '#FF5722'] : ['#2E7D32', '#9C27B0', '#FFC107', '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'],
  fill: {
    type: 'solid',
    opacity: 0.7
  },
  markers: {
    size: 0
  },
  legend: {
    show: true,
    showForSingleSeries: false
  },
  grid: {
    borderColor: '#e0e0e0',
    strokeDashArray: 1,
    xaxis: {
      lines: {
        show: false
      }
    },
    yaxis: {
      lines: {
        show: true
      }
    }
  },
  tooltip: {
    x: {
      format: 'dd MMM HH:mm'
    },
    y: {
      formatter: (value: number, { seriesIndex }: any) => {
        if (config.showSensorValues && seriesIndex === 3) {
          return value.toFixed(1) // Sensor values without %
        }
        return `${value.toFixed(1)}%` // Probability values with %
      }
    }
  },
  dataLabels: {
    enabled: false
  }
  }
  
  return options
}

export const transformSimulationData = (
  points: Array<{timestamp: Date, probability: number, sensorState: boolean, activeObservations?: string[]}>,
  includeEntityStates: boolean = false,
  visibleEntities: Set<string> = new Set()
) => {
  // Optimize data transformation for large datasets
  const dataLength = points.length
  const probabilityData = new Array(dataLength)
  const stateData = new Array(dataLength)
  
  // Track unique entities if we need entity states
  const entityStateData: Map<string, Array<{x: number, y: number}>> = new Map()
  
  for (let i = 0; i < dataLength; i++) {
    const point = points[i]
    const timestamp = point.timestamp.getTime()
    probabilityData[i] = { x: timestamp, y: point.probability * 100 }
    stateData[i] = { x: timestamp, y: point.sensorState ? 100 : 0 }
    
    // Process individual entity states if needed
    if (includeEntityStates && point.activeObservations) {
      // Initialize arrays for new entities
      point.activeObservations.forEach(entityId => {
        if (!entityStateData.has(entityId)) {
          entityStateData.set(entityId, new Array(dataLength))
        }
      })
      
      // Set state for all tracked entities at this timestamp
      for (const [entityId, data] of entityStateData) {
        const isActive = point.activeObservations.includes(entityId)
        data[i] = { x: timestamp, y: isActive ? 85 : 15 } // Offset from 0 and 100 for visibility
      }
    }
  }

  const series = [
    {
      name: 'Probability',
      data: probabilityData,
      type: 'line'
    },
    {
      name: 'Sensor State (ON/OFF)',
      data: stateData,
      type: 'area'
    }
  ]
  
  // Add entity state series if requested and visible
  if (includeEntityStates) {
    let colorIndex = 2 // Start after the first two series
    for (const [entityId, data] of entityStateData) {
      if (visibleEntities.size === 0 || visibleEntities.has(entityId)) {
        series.push({
          name: entityId.split('.').pop() || entityId, // Use friendly name
          data: data.filter(d => d !== undefined), // Remove any undefined entries
          type: 'line'
        })
        colorIndex++
      }
    }
  }

  return series
}